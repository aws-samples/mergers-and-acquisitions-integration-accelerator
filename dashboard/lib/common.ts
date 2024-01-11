// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { RemovalPolicy, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Key, KeySpec, KeyUsage } from "aws-cdk-lib/aws-kms";

export class Common extends Construct {
  readonly key: Key;
  readonly application: string;
  readonly environment: string;
  readonly quicksightUser: string;

  constructor(scope: Construct, id: string, region: string, account: string) {
    super(scope, id);

    this.application =
      this.node.tryGetContext("application") || "maia-dashboard";
    this.environment = this.node.tryGetContext("environment") || "dev";
    this.quicksightUser = this.node.tryGetContext("quicksight-user");

    this.key = new Key(this, `${this.application}-key`, {
      keySpec: KeySpec.SYMMETRIC_DEFAULT,
      keyUsage: KeyUsage.ENCRYPT_DECRYPT,
      removalPolicy: RemovalPolicy.RETAIN,
      pendingWindow: Duration.days(7),
      alias: `alias/${this.application}-key`,
      description:
        "KMS key for encrypting & decrypting data in DynamoDB, S3, SQS, etc.",
      enableKeyRotation: true,
    });
  }
}
