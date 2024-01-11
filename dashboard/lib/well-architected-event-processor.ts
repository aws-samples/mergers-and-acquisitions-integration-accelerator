// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, RemovalPolicy, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { Rule } from "aws-cdk-lib/aws-events";
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

export interface WellArchitectedEventProcessorStackProps extends StackProps {
  key: Key;
  application: string;
  environment: string;
}

export class WellArchitectedEventProcessor extends Construct {
  constructor(
    scope: Construct,
    id: string,
    region: string,
    account: string,
    props: WellArchitectedEventProcessorStackProps
  ) {
    super(scope, id);

    // Dynamodb table definitions
    const table = new Table(this, "questionnaire-answers", {
      tableName: "questionnaire-answers",
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.key,
      partitionKey: { name: "WorkloadId", type: AttributeType.STRING },
      sortKey: { name: "LensAlias", type: AttributeType.STRING },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    const tableRisks = new Table(this, "questionnaire-answers-risks", {
      tableName: "questionnaire-answers-risks",
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.key,
      partitionKey: { name: "WorkloadIdLensAlias", type: AttributeType.STRING },
      sortKey: { name: "QuestionId", type: AttributeType.STRING },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
    });

    // Well Architected Permissions
    const WAPolicyStatement = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["wellarchitected:Get*", "wellarchitected:List*"],
      resources: ["*"],
    });

    const WAPolicy = new Policy(this, "well-architected-policy-document", {
      statements: [WAPolicyStatement],
    });

    // Create Lambda Function
    const handler = new Function(
      this,
      "well-architected-event-processor-handler",
      {
        functionName: props.application + "-well-architected-event-processor",
        runtime: Runtime.PYTHON_3_12,
        code: Code.fromAsset("resources/well-architected-event-processor"),
        handler: "lambda_function.lambda_handler",
        timeout: Duration.seconds(60),
        environment: {
          TABLE_NAME: table.tableName,
          RISKS_TABLE_NAME: tableRisks.tableName,
        },
      }
    );

    // Attach Well Architected Permissions
    handler.role?.attachInlinePolicy(WAPolicy);

    // Grant Encrypt and Decrypt permissions to Lambda Function
    props.key.grantEncryptDecrypt(handler);

    // Grant R/W access to DynamoDB Tables to Lambda Function
    table.grantReadWriteData(handler);
    tableRisks.grantReadWriteData(handler);

    const rule = new Rule(this, "well-architected-eventbridge-rule", {
      eventPattern: {
        source: ["aws.wellarchitected"],
        detailType: ["AWS API Call via CloudTrail"],
      },
    });

    const dlq = new Queue(this, "well-architected-eventbridge-rule-dlq", {
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
