# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import boto3
import botocore
import json
import urllib.parse
import os
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

logging.getLogger('boto3').setLevel(logging.CRITICAL)
logging.getLogger('botocore').setLevel(logging.CRITICAL)
logging.getLogger('wellarchitected').setLevel(logging.CRITICAL)


def lambda_handler(event, context):
    request_parameters = event.get('detail').get('requestParameters')
    event_name = event.get('detail').get('eventName')
    if request_parameters and event_name == 'UpdateAnswer':
        question_id = request_parameters.get('QuestionId')
        workload_id = request_parameters.get('WorkloadId')
        lens_alias = request_parameters.get('LensAlias')
        if question_id and workload_id and lens_alias:
            lens_alias = urllib.parse.unquote(lens_alias)
            logger.info(
                f"Event: {event_name}, WorkloadId: {workload_id}, LensAlias: {lens_alias}, QuestionId:{question_id}")
            logger.debug("Received event: " + json.dumps(event, indent=2))
            # List Answers for WorkloadId and LensAlias
            answer = {}
            risks = []
            try:
                waf = boto3.client('wellarchitected')
                workload = waf.get_workload(WorkloadId=workload_id)
                lens = waf.get_lens(LensAlias=lens_alias)
                answers = waf.list_answers(
                    WorkloadId=workload_id, LensAlias=lens_alias)
            except botocore.exceptions.ParamValidationError as e:
                logger.error("ERROR - Parameter validation error: %s" % e)
            except botocore.exceptions.ClientError as e:
                logger.error("ERROR - Unexpected error: %s" % e)
            except botocore.exceptions.ValidationException as e:
                logger.error("ERROR - Validation error: %s" % e)
            except botocore.exceptions.InternalServerException as e:
                logger.error("ERROR - Internal server error: %s" % e)
            except botocore.exceptions.ResourceNotFoundException as e:
                logger.error("ERROR - Resource Not Found error: %s" % e)
            except botocore.exceptions.AccessDeniedException as e:
                logger.error("ERROR - Access Denied error: %s" % e)
            except botocore.exceptions.ThrottlingException as e:
                logger.error("ERROR - Throttling error: %s" % e)

            answer['WorkloadId'] = workload_id
            answer['LensAlias'] = lens_alias
            answer['AnswerSummaries'] = []
            answer['AnswerSummaries'].append(answers.get('AnswerSummaries'))

            for answer_summary in answers.get('AnswerSummaries'):
                risk = {}
                risk['WorkloadIdLensAlias'] = workload_id + lens_alias
                risk['QuestionId'] = answer_summary['QuestionId']
                risk['WorkloadId'] = workload_id
                risk['WorkloadName'] = workload.get(
                    'Workload').get('WorkloadName')
                risk['LensAlias'] = lens_alias
                risk['LensName'] = lens.get('Lens').get('Name')
                risk['QuestionTitle'] = answer_summary['QuestionTitle']
                risk['Risk'] = answer_summary['Risk']
                risks.append(risk)

            next_token = answers.get('NextToken')
            logger.debug(f"nextToken: ${next_token}")
            while next_token:
                answers = waf.list_answers(
                    WorkloadId=workload_id, LensAlias=lens_alias, NextToken=next_token)
                answer['AnswerSummaries'].append(
                    answers.get('AnswerSummaries'))
                next_token = answers.get('NextToken')

                for answer_summary in answers.get('AnswerSummaries'):
                    risk = {}
                    risk['WorkloadIdLensAlias'] = workload_id + lens_alias
                    risk['QuestionId'] = answer_summary['QuestionId']
                    risk['WorkloadId'] = workload_id
                    risk['WorkloadName'] = workload.get(
                        'Workload').get('WorkloadName')
                    risk['LensAlias'] = lens_alias
                    risk['LensName'] = lens.get('Lens').get('Name')
                    risk['QuestionTitle'] = answer_summary['QuestionTitle']
                    risk['Risk'] = answer_summary['Risk']
                    risks.append(risk)

                logger.debug(f"nextToken: ${next_token}")

            # Insert in dynamodb
            dynamodb = boto3.resource(
                'dynamodb', region_name=os.environ['AWS_REGION'])
            table = dynamodb.Table(os.environ['TABLE_NAME'])
            table_risks = dynamodb.Table(os.environ['RISKS_TABLE_NAME'])
            table.put_item(Item=answer)
            for risk in risks:
                table_risks.put_item(Item=risk)

    return