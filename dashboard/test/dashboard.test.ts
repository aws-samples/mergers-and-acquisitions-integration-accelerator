// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { App, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as Dashboard from "../lib/dashboard-stack";
import { Key, KeySpec, KeyUsage } from "aws-cdk-lib/aws-kms";

const app = new App();
const stack = new Dashboard.DashboardStack(app, "DashboardStack");
const template = Template.fromStack(stack);

test("KMS Key Test", () => {
  template.hasResourceProperties("AWS::KMS::Key", {
    KeySpec: KeySpec.SYMMETRIC_DEFAULT,
    KeyUsage: KeyUsage.ENCRYPT_DECRYPT,
  });
});

test("S3 Bucket w/ KMS Key Encryption Test", () => {
  template.hasResourceProperties(
    "AWS::S3::Bucket",
    Match.objectLike({
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "aws:kms",
            },
          },
        ],
      },
    })
  );
});

test("Conformance Pack Compliance Summary DynamoDB Table Test", () => {
  template.hasResourceProperties(
    "AWS::DynamoDB::Table",
    Match.objectLike({
      TableName: "conformance-pack-compliance-summary",
    })
  );
});

test("Conformance Pack Compliance Detail DynamoDB Table Test", () => {
  template.hasResourceProperties(
    "AWS::DynamoDB::Table",
    Match.objectLike({
      TableName: "conformance-pack-compliance-detail",
    })
  );
});

test("Conformance Pack Compliance Playbook DynamoDB Table Test", () => {
  template.hasResourceProperties(
    "AWS::DynamoDB::Table",
    Match.objectLike({
      TableName: "conformance-pack-compliance-playbook",
    })
  );
});

test("Conformance Pack Compliance Remediation DynamoDB Table Test", () => {
  template.hasResourceProperties(
    "AWS::DynamoDB::Table",
    Match.objectLike({
      TableName: "conformance-pack-compliance-remediation",
    })
  );
});

test("Conformance Pack Compliance Scheduled Event Test", () => {
  template.hasResourceProperties("AWS::Events::Rule", {
    ScheduleExpression: "cron(0/5 * * * ? *)",
  });
});

test("Conformance Pack Compliance Processor Lambda Function Test", () => {
  template.hasResourceProperties(
    "AWS::Lambda::Function",
    Match.objectLike({
      FunctionName: Match.stringLikeRegexp(
        "-conformance-pack-compliance-processor"
      ),
    })
  );
});

test("Questionnaire Answers DynamoDB Table Test", () => {
  template.hasResourceProperties(
    "AWS::DynamoDB::Table",
    Match.objectLike({
      TableName: "questionnaire-answers",
    })
  );
});

test("Questionnaire Answers Risks DynamoDB Table Test", () => {
  template.hasResourceProperties(
    "AWS::DynamoDB::Table",
    Match.objectLike({
      TableName: "questionnaire-answers-risks",
    })
  );
});

test("Well-Architected Triggered Event Test", () => {
  template.hasResourceProperties(
    "AWS::Events::Rule",
    Match.objectLike({
      EventPattern: {
        source: ["aws.wellarchitected"],
      },
    })
  );
});

test("Well-Architected Event Processor Lambda Function Test", () => {
  template.hasResourceProperties(
    "AWS::Lambda::Function",
    Match.objectLike({
      FunctionName: Match.stringLikeRegexp("-well-architected-event-processor"),
    })
  );
});

test("Athena Data Catalog Test", () => {
  template.hasResourceProperties("AWS::Athena::DataCatalog", {
    Type: "LAMBDA",
  });
});

test("QuickSight Data Source Test", () => {
  template.hasResourceProperties(
    "AWS::QuickSight::DataSource",
    Match.objectLike({
      DataSourceId: Match.stringLikeRegexp("-dynamodb"),
    })
  );
});

test("QuickSight Conformance Pack Compliance Summary Dataset Test", () => {
  template.hasResourceProperties(
    "AWS::QuickSight::DataSet",
    Match.objectLike({
      DataSetId: "conformance-pack-compliance-summary",
    })
  );
});

test("QuickSight Conformance Pack Compliance Remediation Dataset Test", () => {
  template.hasResourceProperties(
    "AWS::QuickSight::DataSet",
    Match.objectLike({
      DataSetId: "conformance-pack-compliance-remediation",
    })
  );
});

test("QuickSight Conformance Pack Compliance Detail Dataset Test", () => {
  template.hasResourceProperties(
    "AWS::QuickSight::DataSet",
    Match.objectLike({
      DataSetId: "conformance-pack-compliance-detail",
    })
  );
});

test("QuickSight Questionnaire Answers Risks Dataset Test", () => {
  template.hasResourceProperties(
    "AWS::QuickSight::DataSet",
    Match.objectLike({
      DataSetId: "questionnaire-answers-risks",
    })
  );
});

test("QuickSight Analysis Test", () => {
  template.resourceCountIs("AWS::QuickSight::Analysis", 1);
});

test("QuickSight Dashboard Test", () => {
  template.resourceCountIs("AWS::QuickSight::Dashboard", 1);
});
