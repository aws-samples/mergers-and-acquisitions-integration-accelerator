# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import boto3
import botocore
import json
import urllib.parse
import os
import logging
from decimal import Decimal

logger = logging.getLogger()
logger.setLevel(logging.INFO)

logging.getLogger('boto3').setLevel(logging.CRITICAL)
logging.getLogger('botocore').setLevel(logging.CRITICAL)


def process_scores(summary_response):
    scores = []
    compliance_scores = summary_response.get('ConformancePackComplianceScores')
    for compliance_score in compliance_scores:
        score = {}
        score['ConformancePackName'] = compliance_score.get(
            'ConformancePackName')
        try:
            score['Score'] = Decimal(compliance_score.get('Score'))
        except:
            score['Score'] = Decimal(-1.0)
        scores.append(score)
    return scores


def process_details(detail_response):
    evaluations = []
    conformance_pack_name = detail_response.get('ConformancePackName')
    results = detail_response.get('ConformancePackRuleEvaluationResults')
    for result in results:
        evaluation = {}
        evaluation['ConformancePackName'] = conformance_pack_name
        evaluation['ComplianceType'] = result.get('ComplianceType')
        qualifier = result.get('EvaluationResultIdentifier').get(
            'EvaluationResultQualifier')
        evaluation['ConfigRuleNameResourceId'] = qualifier.get(
            'ConfigRuleName') + qualifier.get('ResourceId')
        evaluation['ConfigRuleName'] = qualifier.get('ConfigRuleName')
        evaluation['ResourceType'] = qualifier.get('ResourceType')
        evaluation['ResourceId'] = qualifier.get('ResourceId')
        evaluations.append(evaluation)
    return evaluations


def get_prefix(config_rule_name):

    config_rule_name = config_rule_name.upper()
    i = config_rule_name.find('-CONFORMANCE-PACK-')
    if i != -1:
        prefix = config_rule_name[:i]
    else:
        prefix = config_rule_name
    prefix = prefix.replace('-', '')
    return prefix


def process_remediations(detail_response, playbooks, remediations, keys):

    logger.debug("Before Process Remediations...")
    logger.debug(f"  Remediations: {remediations}")
    logger.debug(f"  Keys: {keys}")

    results = detail_response.get('ConformancePackRuleEvaluationResults')
    for result in results:
        if result.get('ComplianceType') == 'NON_COMPLIANT':
            qualifier = result.get('EvaluationResultIdentifier').get(
                'EvaluationResultQualifier')
            prefix = get_prefix(qualifier.get('ConfigRuleName'))
            logger.debug(f"Prefix: {prefix}")
            config_playbooks = playbooks.get(prefix)
            if config_playbooks:
                logger.debug("Config Playbooks found")
                for playbook in config_playbooks:
                    playbook_id = playbook['PlaybookId']
                    key = prefix + playbook_id + qualifier.get('ResourceId')
                    if key in keys:
                        logger.debug(f"key: {key} exists")
                    else:
                        keys[key] = 1
                        remediation = {}
                        remediation['ConfigRuleNamePlaybookIdResourceId'] = key
                        remediation['ConfigRuleName'] = qualifier.get(
                            'ConfigRuleName')
                        remediation['ConfigRuleNamePrefix'] = prefix
                        remediation['PlaybookId'] = playbook_id
                        remediation['ResourceType'] = qualifier.get(
                            'ResourceType')
                        remediation['ResourceId'] = qualifier.get('ResourceId')
                        remediation['LOEHours'] = playbook['LOEHours']
                        remediation['LOESprints'] = playbook['LOESprints']
                        remediation['SkillLevel'] = playbook['SkillLevel']
                        remediation['Rank'] = playbook['Rank']
                        remediations.append(remediation)

    logger.debug("After Process Remediations...")
    logger.debug(f"  Remediations: {remediations}")
    logger.debug(f"  Keys: {keys}")

    return remediations, keys


def get_details(summary_response, config_client, table_detail, table_remediation, playbooks):
    details = []
    remediations = []
    keys = {}
    compliance_scores = summary_response.get('ConformancePackComplianceScores')
    for compliance_score in compliance_scores:
        conformance_pack_name = compliance_score.get('ConformancePackName')
        detail_response = config_client.get_conformance_pack_compliance_details(
            ConformancePackName=conformance_pack_name)
        if detail_response:
            logger.debug(
                f"get_conformance_pack_compliance_details response: {detail_response}")
            details.extend(process_details(detail_response))
            remediations, keys = process_remediations(
                detail_response, playbooks, remediations, keys)
            next_token = detail_response.get('NextToken')
            while next_token:
                logger.debug(f"nextToken: {next_token}")
                detail_response = config_client.get_conformance_pack_compliance_details(
                    ConformancePackName=conformance_pack_name, NextToken=next_token)
                if detail_response:
                    details.extend(process_details(detail_response))
                    remediations, keys = process_remediations(
                        detail_response, playbooks, remediations, keys)
                    next_token = detail_response.get('NextToken')
    if details and len(details) > 0:
        with table_detail.batch_writer() as batch:
            for i in range(0, len(details)):
                batch.put_item(Item=details[i])
    if remediations and len(remediations) > 0:
        with table_remediation.batch_writer() as batch:
            for i in range(0, len(remediations)):
                batch.put_item(Item=remediations[i])
    return


def load_playbooks(table_playbook):
    response = table_playbook.scan()
    logger.debug(f"Scan Response {response}")
    data = response['Items']
    while 'LastEvaluatedKey' in response:
        response = table_playbook.scan(
            ExclusiveStartKey=response['LastEvaluatedKey'])
        data.extend(response['Items'])
    logger.debug(f"Scan Response Items: {data}")
    playbooks = {}
    for datum in data:
        if datum['ConfigRuleName'] not in playbooks:
            playbooks[datum['ConfigRuleName']] = []
        playbook = {}
        playbook['PlaybookId'] = datum['PlaybookId']
        playbook['LOEHours'] = datum['LOEHours']
        playbook['LOESprints'] = datum['LOESprints']
        playbook['SkillLevel'] = datum['SkillLevel']
        playbook['Rank'] = datum['Rank']
        playbooks[datum['ConfigRuleName']].append(playbook)

    logger.debug(f"Playbooks (Processed Items): {playbooks}")

    return playbooks


def lambda_handler(event, context):
    table_summary_name = os.environ['SUMMARY_TABLE_NAME']
    table_detail_name = os.environ['DETAIL_TABLE_NAME']
    table_playbook_name = os.environ['PLAYBOOK_TABLE_NAME']
    table_remediation_name = os.environ['REMEDIATION_TABLE_NAME']
    logger.info(
        f"Summary Table Name: {table_summary_name}, Detail Table Name: {table_detail_name}, Playbook Table Name: {table_playbook_name}, Remediation Table Name: {table_remediation_name}")
    dynamodb = boto3.resource('dynamodb', region_name=os.environ['AWS_REGION'])
    table_summary = dynamodb.Table(table_summary_name)
    table_detail = dynamodb.Table(table_detail_name)
    table_playbook = dynamodb.Table(table_playbook_name)
    table_remediation = dynamodb.Table(table_remediation_name)
    config_client = boto3.client('config')
    scores = []
    playbooks = load_playbooks(table_playbook)
    summary_response = config_client.list_conformance_pack_compliance_scores()
    if summary_response:
        get_details(summary_response, config_client,
                    table_detail, table_remediation, playbooks)
        scores.extend(process_scores(summary_response))
        next_token = summary_response.get('NextToken')
        while next_token:
            logger.debug(f"nextToken: {next_token}")
            summary_response = config_client.list_conformance_pack_compliance_scores(
                NextToken=next_token)
            get_details(summary_response, config_client,
                        table_detail, table_remediation, playbooks)
            scores.extend(process_scores(summary_response))
            next_token = summary_response.get('NextToken')
    if scores and len(scores) > 0:
        with table_summary.batch_writer() as batch:
            for i in range(0, len(scores)):
                batch.put_item(Item=scores[i])
    return