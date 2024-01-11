// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, RemovalPolicy, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { Effect, Policy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";

export interface ConformancePackComplianceProcessorStackProps
  extends StackProps {
  key: Key;
  application: string;
  environment: string;
}

export class ConformancePackComplianceProcessor extends Construct {
  constructor(
    scope: Construct,
    id: string,
    region: string,
    account: string,
    props: ConformancePackComplianceProcessorStackProps
  ) {
    super(scope, id);

    // Dynamodb table definitions
    const tableSummary = new Table(
      this,
      "conformance-pack-compliance-summary",
      {
        tableName: "conformance-pack-compliance-summary",
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: props.key,
        partitionKey: {
          name: "ConformancePackName",
          type: AttributeType.STRING,
        },
        deletionProtection: true,
        removalPolicy: RemovalPolicy.RETAIN,
        billingMode: BillingMode.PAY_PER_REQUEST,
        pointInTimeRecovery: true,
      }
    );

    const tableDetail = new Table(this, "conformance-pack-compliance-detail", {
      tableName: "conformance-pack-compliance-detail",
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.key,
      partitionKey: { name: "ConformancePackName", type: AttributeType.STRING },
      sortKey: { name: "ConfigRuleNameResourceId", type: AttributeType.STRING },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    const tablePlaybook = new Table(
      this,
      "conformance-pack-compliance-playbook",
      {
        tableName: "conformance-pack-compliance-playbook",
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: props.key,
        partitionKey: { name: "ConfigRuleName", type: AttributeType.STRING },
        sortKey: { name: "PlaybookId", type: AttributeType.STRING },
        deletionProtection: true,
        removalPolicy: RemovalPolicy.RETAIN,
        billingMode: BillingMode.PAY_PER_REQUEST,
        pointInTimeRecovery: true,
      }
    );

    const tableRemediation = new Table(
      this,
      "conformance-pack-compliance-remediation",
      {
        tableName: "conformance-pack-compliance-remediation",
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: props.key,
        partitionKey: {
          name: "ConfigRuleNamePlaybookIdResourceId",
          type: AttributeType.STRING,
        },
        deletionProtection: true,
        removalPolicy: RemovalPolicy.RETAIN,
        billingMode: BillingMode.PAY_PER_REQUEST,
        pointInTimeRecovery: true,
      }
    );

    // Config
    const ConfigPolicyStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "config:ListConformancePackComplianceScores",
        "config:GetConformancePackComplianceDetails",
      ],
      // cfn_nag_scan W12 - IAM policy should not allow * resource - Ignore since the purpose of this is to be able to list and get compliance scores and details for all conformance packs
      resources: ["*"],
    });

    const ConfigPolicy = new Policy(this, "config-policy-document", {
      statements: [ConfigPolicyStatement],
    });

    // Create Lambda Function
    const handler = new Function(
      this,
      "conformance-pack-compliance-processor-handler",
      {
        functionName:
          props.application + "-conformance-pack-compliance-processor",
        runtime: Runtime.PYTHON_3_12,
        code: Code.fromAsset("resources/conformance-pack-compliance-processor"),
        handler: "lambda_function.lambda_handler",
        memorySize: 512,
        timeout: Duration.seconds(60),
        environment: {
          SUMMARY_TABLE_NAME: tableSummary.tableName,
          DETAIL_TABLE_NAME: tableDetail.tableName,
          REMEDIATION_TABLE_NAME: tableRemediation.tableName,
          PLAYBOOK_TABLE_NAME: tablePlaybook.tableName,
        },
      }
    );

    // Attach Config Permissions
    handler.role?.attachInlinePolicy(ConfigPolicy);

    // Grant Encrypt and Decrypt permissions to Lambda Function
    props.key.grantEncryptDecrypt(handler);

    // Grant R/W access to DynamoDB Tables to Lambda Function
    tableSummary.grantReadWriteData(handler);
    tableDetail.grantReadWriteData(handler);
    tablePlaybook.grantReadWriteData(handler);
    tableRemediation.grantReadWriteData(handler);

    const rule = new Rule(this, "conformance-pack-eventbridge-rule", {
      schedule: Schedule.cron({ minute: "0/5" }),
    });

    const dlq = new Queue(this, "conformance-eventbridge-rule-dlq", {
      encryption: QueueEncryption.KMS,
      encryptionMasterKey: props.key,
    });

    rule.addTarget(
      new LambdaFunction(handler, {
        deadLetterQueue: dlq, // Optional: add a dead letter queue
        maxEventAge: Duration.hours(2), // Optional: set the maxEventAge retry policy
        retryAttempts: 2, // Optional: set the max number of retry attempts
      })
    );
  }
}
