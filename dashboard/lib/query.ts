// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { StackProps } from "aws-cdk-lib";
import { CfnDataCatalog } from "aws-cdk-lib/aws-athena";
import { Construct } from "constructs";
import { CfnApplication } from "aws-cdk-lib/aws-sam";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  PolicyDocument,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";

export interface QueryStackProps extends StackProps {
  key: Key;
  application: string;
  environment: string;
}

export class Query extends Construct {
  readonly spillBucket: Bucket;
  readonly athenaDataCatalog: CfnDataCatalog;
  readonly lambdaFunctionArn: string;

  constructor(
    scope: Construct,
    id: string,
    region: string,
    account: string,
    props: QueryStackProps
  ) {
    super(scope, id);

    const athenaCatalogName = `${props.application}-athena-dynamodb-connector`;

    this.spillBucket = new Bucket(this, "SpillBucket", {
      encryption: BucketEncryption.KMS,
      encryptionKey: props.key,
    });

    //  Policy Statement 1
    const queryPolicyStatement1 = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "dynamodb:DescribeTable",
        "dynamodb:ListSchemas",
        "dynamodb:ListTables",
        "dynamodb:Query",
        "dynamodb:Scan",
        "glue:GetTableVersions",
        "glue:GetPartitions",
        "glue:GetTables",
        "glue:GetTableVersion",
        "glue:GetDatabases",
        "glue:GetTable",
        "glue:GetPartition",
        "glue:GetDatabase",
        "athena:GetQueryExecution",
        "s3:ListAllMyBuckets",
      ],
      resources: ["*"],
    });

    //  Policy Statement 2
    const queryPolicyStatement2 = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "s3:GetObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetObjectVersion",
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetLifecycleConfiguration",
        "s3:PutLifecycleConfiguration",
        "s3:DeleteObject",
      ],
      resources: [
        `arn:aws:s3:::${this.spillBucket.bucketName}`,
        `arn:aws:s3:::${this.spillBucket.bucketName}/*`,
      ],
    });

    //  Policy Statement 3
    const queryPolicyStatement3 = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["kms:GenerateRandom"],
      resources: ["*"],
    });

    //  Policy Statement 4
    const queryPolicyStatement4 = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*",
      ],
      resources: [props.key.keyArn],
    });

    //  Policy Statement 5
    const queryPolicyStatement5 = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ],
      resources: ["*"],
    });

    const queryPolicyDocument = new PolicyDocument();
    queryPolicyDocument.addStatements(queryPolicyStatement1);
    queryPolicyDocument.addStatements(queryPolicyStatement2);
    queryPolicyDocument.addStatements(queryPolicyStatement3);
    queryPolicyDocument.addStatements(queryPolicyStatement4);
    queryPolicyDocument.addStatements(queryPolicyStatement5);

    const queryPolicy = new ManagedPolicy(this, "QueryPolicyDocument", {
      description: "An IAM Policy that allows Athena to Query DynamoDB",
      managedPolicyName: `${props.application}-${props.environment}-query-policy`,
      document: queryPolicyDocument,
    });

    const connectorRole = new Role(this, "AthenaToDynamoDBConnectorRole", {
      roleName: `${props.application}-${props.environment}-query-role`,
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [queryPolicy],
    });

    //  Create Athena to DynamoDB Connector
    new CfnApplication(this, "AthenaToDynamoDBConnector", {
      location: {
        applicationId:
          "arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaDynamoDBConnector",
        semanticVersion: "2023.49.2",
      },
      parameters: {
        AthenaCatalogName: athenaCatalogName,
        SpillBucket: this.spillBucket.bucketName,
        KMSKeyId: props.key.keyId,
        LambdaRole: connectorRole.roleArn,
      },
    });

    //  Build Lambda function ARN, retrieve by ARN, grant Encrypt & Decrypt to CMK used for encryption at REST for DynamoDB Tables and S3 Bucket
    this.lambdaFunctionArn = `arn:aws:lambda:${region}:${account}:function:${athenaCatalogName}`;

    //  Create Athena Data Catalog
    this.athenaDataCatalog = new CfnDataCatalog(this, "AthenaDataCatalog", {
      name: `${props.application}-dynamodb`,
      type: "LAMBDA",
      parameters: {
        "metadata-function": this.lambdaFunctionArn,
        "record-function": this.lambdaFunctionArn,
      },
    });
  }
}
