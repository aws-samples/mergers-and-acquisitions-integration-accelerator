#!/usr/bin/python3

# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import boto3
import pandas as pd
import json
from boto3.dynamodb.conditions import Key
from re import sub
import logging
import argparse

TABLE_NAME = 'conformance-pack-compliance-playbook'
DEFAULT_EXCEL_FILE = 'ConfigRulePlaybookMapping.xlsx'
DEFAULT_AWS_REGION = 'us-east-1'

COLUMN_NAME_CONFIG_RULE_ID = 'AWS Config'
COLUMN_NAME_PLAYBOOK_ID = 'Playbook ID'
COLUMN_NAME_LOE_HOURS = 'LOEHours'
COLUMN_NAME_LOE_SPRINTS = 'LOESprints'
COLUMN_NAME_SKILL_LEVEL = 'SkillLevel'
COLUMN_NAME_RANK = 'Rank'

INCONSISTENT_NAMES = {
    "ec2-instance-managed-by-systems-manager": "ec2-instance-managed-by-ssm",
    "ec2-instances-in-vpc": "instances-in-vpc",
    "restricted-common-ports": "restricted-incoming-traffic",
    "restricted-ssh": "incoming-ssh-disabled",
    "iam-password-policy": "iam-password-policy-check"
}

DEFAULT_LOE_HOURS = 1
DEFAULT_LOE_SPRINTS = 1
DEFAULT_SKILL_LEVEL = 1
DEFAULT_RANK = 1


def build_normalized_name(id):
    if id in INCONSISTENT_NAMES:
        id = INCONSISTENT_NAMES[id]
    name = str(id)
    name = name.upper()
    name = name.replace('-', '')
    name = name.replace('_', '')
    return name


def init_parser() -> argparse.ArgumentParser:
    """
        Initialize command line parser
    """
    _parser = argparse.ArgumentParser()
    _parser.add_argument("--excel-file", type=str,
                         required=False, default=DEFAULT_EXCEL_FILE)
    _parser.add_argument("--region", type=str,
                         required=False, default=DEFAULT_AWS_REGION)
    return _parser


def main():

    logger = logging.getLogger()
    logger.setLevel(logging.INFO)

    logging.getLogger('boto3').setLevel(logging.CRITICAL)
    logging.getLogger('botocore').setLevel(logging.CRITICAL)

    parser = init_parser()
    args, _ = parser.parse_known_args()
    excel_file = args.excel_file
    region = args.region

    dynamodb = boto3.resource('dynamodb', region_name=region)
    table = dynamodb.Table(TABLE_NAME)

    sheet = pd.read_excel(excel_file)
    sheet.fillna('', inplace=True)

    items = []
    keys = {}
    for index, row in sheet[0:].iterrows():
        config_rule_id = row.get(COLUMN_NAME_CONFIG_RULE_ID)
        playbook_id = row.get(COLUMN_NAME_PLAYBOOK_ID)
        if config_rule_id and playbook_id:
            logging.info(
                f"Config Rule Id: {config_rule_id}, Playbook Id: {playbook_id}")
            item = {}
            item['ConfigRuleName'] = build_normalized_name(config_rule_id)
            item['PlaybookId'] = playbook_id
            key = item['ConfigRuleName'] + '_' + item['PlaybookId']
            if key not in keys:
                keys[key] = 1
                loe_hours = row.get(COLUMN_NAME_LOE_HOURS)
                if loe_hours:
                    item['LOEHours'] = str(loe_hours)
                else:
                    item['LOEHours'] = str(DEFAULT_LOE_HOURS)
                loe_sprints = row.get(COLUMN_NAME_LOE_SPRINTS)
                if loe_sprints:
                    item['LOESprints'] = str(loe_sprints)
                else:
                    item['LOESprints'] = DEFAULT_LOE_SPRINTS
                skill_level = row.get(COLUMN_NAME_SKILL_LEVEL)
                if skill_level:
                    item['SkillLevel'] = str(skill_level)
                else:
                    item['SkillLevel'] = DEFAULT_SKILL_LEVEL
                rank = row.get(COLUMN_NAME_RANK)
                if rank:
                    item['Rank'] = str(rank)
                else:
                    item['Rank'] = DEFAULT_RANK
                items.append(item)

    if items and len(items) > 0:
        with table.batch_writer() as batch:
            for i in range(0, len(items)):
                batch.put_item(Item=items[i])


if __name__ == '__main__':
    main()