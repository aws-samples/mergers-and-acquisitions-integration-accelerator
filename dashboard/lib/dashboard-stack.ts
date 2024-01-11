// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { WellArchitectedEventProcessor } from "./well-architected-event-processor";
import { ConformancePackComplianceProcessor } from "./conformance-pack-compliance-processor";
import { Common } from "./common";
import { Query } from "./query";
import { Visualization } from "./visualization";

export class DashboardStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const region: string = this.region;
    const account: string = this.account;

    const commonEntity = new Common(this, "Common", region, account);

    new WellArchitectedEventProcessor(
      this,
      "WellArchitectedEventProcessor",
      region,
      account,
      {
        key: commonEntity.key,
        application: commonEntity.application,
        environment: commonEntity.environment,
      }
    );

    new ConformancePackComplianceProcessor(
      this,
      "ConformancePackComplianceProcessor",
      region,
      account,
      {
        key: commonEntity.key,
        application: commonEntity.application,
        environment: commonEntity.environment,
      }
    );

    const queryEntity = new Query(this, "Query", region, account, {
      key: commonEntity.key,
      application: commonEntity.application,
      environment: commonEntity.environment,
    });

    new Visualization(this, "Visualization", region, account, {
      key: commonEntity.key,
      application: commonEntity.application,
      environment: commonEntity.environment,
      spillBucket: queryEntity.spillBucket,
      athenaDataCatalog: queryEntity.athenaDataCatalog,
      quicksightUser: commonEntity.quicksightUser,
      lambdaFunctionArn: queryEntity.lambdaFunctionArn,
    });
  }
}
