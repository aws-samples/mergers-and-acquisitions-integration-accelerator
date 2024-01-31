// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { StackProps } from "aws-cdk-lib";
import { CfnDataCatalog } from "aws-cdk-lib/aws-athena";
import { Construct } from "constructs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  Effect,
  Policy,
  PolicyDocument,
  PolicyStatement,
  Role,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import {
  CfnAnalysis,
  CfnDashboard,
  CfnDataSource,
  CfnDataSet,
} from "aws-cdk-lib/aws-quicksight";

export interface VisualizationStackProps extends StackProps {
  key: Key;
  application: string;
  environment: string;
  spillBucket: Bucket;
  athenaDataCatalog: CfnDataCatalog;
  quicksightUser: string;
  lambdaFunctionArn: string;
}

export class Visualization extends Construct {
  constructor(
    scope: Construct,
    id: string,
    region: string,
    account: string,
    props: VisualizationStackProps
  ) {
    super(scope, id);

    //  Retrieve existing QuickSight Service Role
    const quicksightServcieRole = Role.fromRoleArn(
      this,
      "quicksight-service-role",
      `arn:aws:iam::${account}:role/service-role/aws-quicksight-service-role-v0`
    );

    //  S3 List All Buckets Policy Statement
    const policyStmtS3ListAllBuckets  = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:ListAllMyBuckets"],
      resources: ["*"],
    });

    //  S3 Athena Spill Bucket Policy Statement
    const policyStmtS3AthenaSpillBucket = new PolicyStatement({
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
        "s3:AbortMultipartUpload",
      ],
      resources: [
        `arn:aws:s3:::${props.spillBucket.bucketName}`,
        `arn:aws:s3:::${props.spillBucket.bucketName}/*`,
      ],
    });

    //  KMS Generate Random Policy Statement
    const policyStmtKmsGenerateRandom = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["kms:GenerateRandom"],
      resources: ["*"],
    });

    //  KMS CMK Encrypt / Decrypt Policy Statement
    const policyStmtKmsCmkEncryptDecrypt = new PolicyStatement({
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

    //  CloudWatch Logs Policy Statement
    const policyStmtCloudWatchLogs = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ],
      resources: ["*"],
    });

    //  Athena DynamoDB Connector Invoke Lambda Policy Statement
    const policyStmtAthenaDynamoDbConnectorInvokeLambda = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["lambda:InvokeFunction"],
      resources: [props.lambdaFunctionArn],
    });

    const visualizationPolicyDocument = new PolicyDocument();
    visualizationPolicyDocument.addStatements(policyStmtS3ListAllBuckets);
    visualizationPolicyDocument.addStatements(policyStmtS3AthenaSpillBucket);
    visualizationPolicyDocument.addStatements(policyStmtKmsGenerateRandom);
    visualizationPolicyDocument.addStatements(policyStmtKmsCmkEncryptDecrypt);
    visualizationPolicyDocument.addStatements(policyStmtCloudWatchLogs);
    visualizationPolicyDocument.addStatements(policyStmtAthenaDynamoDbConnectorInvokeLambda);

    //  Update QuickSight Service Role with necessary permissions
    quicksightServcieRole.attachInlinePolicy(
      new Policy(this, "VisualizationPolicy", {
        document: visualizationPolicyDocument,
      })
    );

    const dataSourceId = `${props.application}-${props.environment}-athena`;

    //  QuickSight Principal ARN - have to update quicksight-user in cdk.json or pass as context argument
    
    let qsPrincipalArn = `arn:aws:quicksight:${region}:${account}:user/default/${props.quicksightUser}`;
    const arnRegex = /^arn:(aws|aws-cn|aws-us-gov|aws-iso|aws-iso-b):([a-zA-Z0-9\-]*):(\w+(?:-\w+)+):(\d{12}):(.*)$/;
    const regex = new RegExp(arnRegex,'i');
    const matches = regex.exec(qsPrincipalArn);
    if (matches && matches.length === 6 && matches[2] === 'quicksight' && matches[5].startsWith('user')) {
      qsPrincipalArn = props.quicksightUser;
    }
    
    //  QuickSight DataSource
    const dataSource = new CfnDataSource(this, "AthenaDataSource", {
      type: "ATHENA",
      awsAccountId: account,
      dataSourceId: props.athenaDataCatalog.name,
      name: props.athenaDataCatalog.name,
      dataSourceParameters: {
        athenaParameters: {
          workGroup: "primary",
        },
      },
      permissions: [
        {
          actions: [
            "quicksight:DescribeDataSource",
            "quicksight:DescribeDataSourcePermissions",
            "quicksight:PassDataSource",
            "quicksight:UpdateDataSource",
            "quicksight:DeleteDataSource",
            "quicksight:UpdateDataSourcePermissions",
          ],
          principal: qsPrincipalArn,
        },
      ],
    });

    //  QuickSight DataSet 1
    const dataset1 = new CfnDataSet(
      this,
      "conformance-pack-compliance-summary",
      {
        awsAccountId: account,
        dataSetId: "conformance-pack-compliance-summary",
        name: "conformance-pack-compliance-summary",
        importMode: "DIRECT_QUERY",
        physicalTableMap: {
          "conformance-pack-compliance-summary-physical": {
            relationalTable: {
              catalog: props.athenaDataCatalog.name,
              schema: "default",
              name: "conformance-pack-compliance-summary",
              dataSourceArn: dataSource.attrArn,
              inputColumns: [
                {
                  name: "ConformancePackName",
                  type: "STRING",
                },
                {
                  name: "Score",
                  type: "DECIMAL",
                },
              ],
            },
          },
        },
        logicalTableMap: {
          "conformance-pack-compliance-summary-logical": {
            alias: "conformance-pack-compliance-summary",
            source: {
              physicalTableId: "conformance-pack-compliance-summary-physical",
            },
          },
        },
        permissions: [
          {
            actions: [
              "quicksight:DescribeDataSet",
              "quicksight:DescribeDataSetPermissions",
              "quicksight:PassDataSet",
              "quicksight:DescribeIngestion",
              "quicksight:ListIngestions",
              "quicksight:UpdateDataSet",
              "quicksight:DeleteDataSet",
              "quicksight:CreateIngestion",
              "quicksight:CancelIngestion",
              "quicksight:UpdateDataSetPermissions",
            ],
            principal: qsPrincipalArn,
          },
        ],
      }
    );

    //  QuickSight DataSet 2
    const dataset2 = new CfnDataSet(
      this,
      "conformance-pack-compliance-remediation",
      {
        awsAccountId: account,
        dataSetId: "conformance-pack-compliance-remediation",
        name: "conformance-pack-compliance-remediation",
        importMode: "DIRECT_QUERY",
        physicalTableMap: {
          "conformance-pack-compliance-remediation-physical": {
            relationalTable: {
              catalog: props.athenaDataCatalog.name,
              schema: "default",
              name: "conformance-pack-compliance-remediation",
              dataSourceArn: dataSource.attrArn,
              inputColumns: [
                {
                  name: "ConfigRuleNamePrefix",
                  type: "STRING",
                },
                {
                  name: "SkillLevel",
                  type: "STRING",
                },
                {
                  name: "LOEHours",
                  type: "STRING",
                },
                {
                  name: "ResourceId",
                  type: "STRING",
                },
                {
                  name: "ConfigRuleName",
                  type: "STRING",
                },
                {
                  name: "PlaybookId",
                  type: "STRING",
                },
                {
                  name: "Rank",
                  type: "STRING",
                },
                {
                  name: "ResourceType",
                  type: "STRING",
                },
                {
                  name: "ConfigRuleNamePlaybookIdResourceId",
                  type: "STRING",
                },
                {
                  name: "LOESprints",
                  type: "STRING",
                },
              ],
            },
          },
        },
        logicalTableMap: {
          "conformance-pack-compliance-remediation-logical": {
            alias: "conformance-pack-compliance-remediation",
            dataTransforms: [
              {
                castColumnTypeOperation: {
                  columnName: "LOEHours",
                  newColumnType: "DECIMAL",
                },
              },
              {
                castColumnTypeOperation: {
                  columnName: "Rank",
                  newColumnType: "DECIMAL",
                },
              },
              {
                projectOperation: {
                  projectedColumns: [
                    "ConfigRuleNamePrefix",
                    "SkillLevel",
                    "LOEHours",
                    "ResourceId",
                    "ConfigRuleName",
                    "PlaybookId",
                    "Rank",
                    "ResourceType",
                    "ConfigRuleNamePlaybookIdResourceId",
                    "LOESprints",
                  ],
                },
              },
            ],
            source: {
              physicalTableId:
                "conformance-pack-compliance-remediation-physical",
            },
          },
        },
        permissions: [
          {
            actions: [
              "quicksight:DescribeDataSet",
              "quicksight:DescribeDataSetPermissions",
              "quicksight:PassDataSet",
              "quicksight:DescribeIngestion",
              "quicksight:ListIngestions",
              "quicksight:UpdateDataSet",
              "quicksight:DeleteDataSet",
              "quicksight:CreateIngestion",
              "quicksight:CancelIngestion",
              "quicksight:UpdateDataSetPermissions",
            ],
            principal: qsPrincipalArn,
          },
        ],
      }
    );

    //  QuickSight DataSet 3
    const dataset3 = new CfnDataSet(
      this,
      "conformance-pack-compliance-detail",
      {
        awsAccountId: account,
        dataSetId: "conformance-pack-compliance-detail",
        name: "conformance-pack-compliance-detail",
        importMode: "DIRECT_QUERY",
        physicalTableMap: {
          "conformance-pack-compliance-detail-physical": {
            relationalTable: {
              catalog: props.athenaDataCatalog.name,
              schema: "default",
              name: "conformance-pack-compliance-detail",
              dataSourceArn: dataSource.attrArn,
              inputColumns: [
                {
                  name: "ComplianceType",
                  type: "STRING",
                },
                {
                  name: "ResourceId",
                  type: "STRING",
                },
                {
                  name: "ConfigRuleName",
                  type: "STRING",
                },
                {
                  name: "ConfigRuleNameResourceId",
                  type: "STRING",
                },
                {
                  name: "ConformancePackName",
                  type: "STRING",
                },
                {
                  name: "ResourceType",
                  type: "STRING",
                },
              ],
            },
          },
        },
        logicalTableMap: {
          "conformance-pack-compliance-detail-logical": {
            alias: "conformance-pack-compliance-detail",
            source: {
              physicalTableId: "conformance-pack-compliance-detail-physical",
            },
          },
        },
        permissions: [
          {
            actions: [
              "quicksight:DescribeDataSet",
              "quicksight:DescribeDataSetPermissions",
              "quicksight:PassDataSet",
              "quicksight:DescribeIngestion",
              "quicksight:ListIngestions",
              "quicksight:UpdateDataSet",
              "quicksight:DeleteDataSet",
              "quicksight:CreateIngestion",
              "quicksight:CancelIngestion",
              "quicksight:UpdateDataSetPermissions",
            ],
            principal: qsPrincipalArn,
          },
        ],
      }
    );

    //  QuickSight DataSet 4
    const dataset4 = new CfnDataSet(this, "questionnaire-answers-risks", {
      awsAccountId: account,
      dataSetId: "questionnaire-answers-risks",
      name: "questionnaire-answers-risks",
      importMode: "DIRECT_QUERY",
      physicalTableMap: {
        "questionnaire-answers-risks-physical": {
          relationalTable: {
            catalog: props.athenaDataCatalog.name,
            schema: "default",
            name: "questionnaire-answers-risks",
            dataSourceArn: dataSource.attrArn,
            inputColumns: [
              {
                name: "WorkloadName",
                type: "STRING",
              },
              {
                name: "LensName",
                type: "STRING",
              },
              {
                name: "QuestionId",
                type: "STRING",
              },
              {
                name: "WorkloadId",
                type: "STRING",
              },
              {
                name: "QuestionTitle",
                type: "STRING",
              },
              {
                name: "Risk",
                type: "STRING",
              },
              {
                name: "WorkloadIdLensAlias",
                type: "STRING",
              },
              {
                name: "LensAlias",
                type: "STRING",
              },
            ],
          },
        },
      },
      logicalTableMap: {
        "questionnaire-answers-risks-logical": {
          alias: "questionnaire-answers-risks",
          dataTransforms: [
            {
              projectOperation: {
                projectedColumns: [
                  "WorkloadName",
                  "LensName",
                  "QuestionId",
                  "WorkloadId",
                  "QuestionTitle",
                  "Risk",
                  "WorkloadIdLensAlias",
                  "LensAlias",
                ],
              },
            },
          ],
          source: {
            physicalTableId: "questionnaire-answers-risks-physical",
          },
        },
      },
      permissions: [
        {
          actions: [
            "quicksight:DescribeDataSet",
            "quicksight:DescribeDataSetPermissions",
            "quicksight:PassDataSet",
            "quicksight:DescribeIngestion",
            "quicksight:ListIngestions",
            "quicksight:UpdateDataSet",
            "quicksight:DeleteDataSet",
            "quicksight:CreateIngestion",
            "quicksight:CancelIngestion",
            "quicksight:UpdateDataSetPermissions",
          ],
          principal: qsPrincipalArn,
        },
      ],
    });

    const qsDefinition = {
      dataSetIdentifierDeclarations: [
        {
          identifier: "conformance-pack-compliance-detail",
          dataSetArn: `arn:aws:quicksight:${region}:${account}:dataset/conformance-pack-compliance-detail`,
        },
        {
          identifier: "questionnaire-answers-risks",
          dataSetArn: `arn:aws:quicksight:${region}:${account}:dataset/questionnaire-answers-risks`,
        },
        {
          identifier: "conformance-pack-compliance-remediation",
          dataSetArn: `arn:aws:quicksight:${region}:${account}:dataset/conformance-pack-compliance-remediation`,
        },
        {
          identifier: "conformance-pack-compliance-summary",
          dataSetArn: `arn:aws:quicksight:${region}:${account}:dataset/conformance-pack-compliance-summary`,
        },
      ],
      sheets: [
        {
          sheetId: "2b44ee41-ae73-4b63-b258-95a9b125ff94",
          name: "Questionnaire",
          visuals: [
            {
              barChartVisual: {
                visualId: "16f358cc-ecdd-4a38-8970-562a74f1b904",
                title: {
                  visibility: "VISIBLE",
                  formatText: {
                    richText: "<visual-title>Risk Summary</visual-title>",
                  },
                },
                subtitle: {
                  visibility: "VISIBLE",
                },
                chartConfiguration: {
                  fieldWells: {
                    barChartAggregatedFieldWells: {
                      category: [
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689779240676",
                            column: {
                              dataSetIdentifier: "questionnaire-answers-risks",
                              columnName: "Risk",
                            },
                          },
                        },
                      ],
                      values: [],
                      colors: [],
                    },
                  },
                  sortConfiguration: {
                    categoryItemsLimit: {
                      otherCategories: "INCLUDE",
                    },
                    colorItemsLimit: {
                      otherCategories: "INCLUDE",
                    },
                    smallMultiplesLimitConfiguration: {
                      otherCategories: "INCLUDE",
                    },
                  },
                  orientation: "HORIZONTAL",
                  barsArrangement: "CLUSTERED",
                  visualPalette: {
                    colorMap: [
                      {
                        element: {
                          fieldId:
                            "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689779240676",
                          fieldValue: "HIGH",
                        },
                        color: "#DE3B00",
                      },
                      {
                        element: {
                          fieldId:
                            "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689779240676",
                          fieldValue: "MEDIUM",
                        },
                        color: "#FFB500",
                      },
                      {
                        element: {
                          fieldId:
                            "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689779240676",
                          fieldValue: "NONE",
                        },
                        color: "#2CAD00",
                      },
                      {
                        element: {
                          fieldId:
                            "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689779240676",
                          fieldValue: "UNANSWERED",
                        },
                        color: "#EEEEEE",
                      },
                    ],
                  },
                  dataLabels: {
                    visibility: "HIDDEN",
                    overlap: "DISABLE_OVERLAP",
                  },
                  tooltip: {
                    tooltipVisibility: "VISIBLE",
                    selectedTooltipType: "DETAILED",
                    fieldBasedTooltip: {
                      aggregationVisibility: "HIDDEN",
                      tooltipTitleType: "PRIMARY_VALUE",
                      tooltipFields: [
                        {
                          fieldTooltipItem: {
                            fieldId:
                              "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689779240676",
                            visibility: "VISIBLE",
                          },
                        },
                      ],
                    },
                  },
                },
                actions: [
                  {
                    customActionId: "b85644fa-8cc8-4b91-a433-4b30e851c5e2",
                    name: "Filter Risk on All Visuals",
                    status: "ENABLED",
                    trigger: "DATA_POINT_CLICK",
                    actionOperations: [
                      {
                        filterOperation: {
                          selectedFieldsConfiguration: {
                            selectedFields: [
                              "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689779240676",
                            ],
                          },
                          targetVisualsConfiguration: {
                            sameSheetTargetVisualConfiguration: {
                              targetVisualOptions: "ALL_VISUALS",
                            },
                          },
                        },
                      },
                    ],
                  },
                ],
                columnHierarchies: [],
              },
            },
            {
              tableVisual: {
                visualId: "b2fadf05-5999-4533-96eb-a1f476d82487",
                title: {
                  visibility: "VISIBLE",
                  formatText: {
                    richText: "<visual-title>Risk Detail</visual-title>",
                  },
                },
                subtitle: {
                  visibility: "VISIBLE",
                },
                chartConfiguration: {
                  fieldWells: {
                    tableAggregatedFieldWells: {
                      groupBy: [
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689780820533",
                            column: {
                              dataSetIdentifier: "questionnaire-answers-risks",
                              columnName: "Risk",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "b2ac680d-b919-4a93-b55d-183fbf5abafb.QuestionTitle.1.1689780825034",
                            column: {
                              dataSetIdentifier: "questionnaire-answers-risks",
                              columnName: "QuestionTitle",
                            },
                          },
                        },
                      ],
                      values: [],
                    },
                  },
                  sortConfiguration: {
                    rowSort: [
                      {
                        fieldSort: {
                          fieldId:
                            "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689780820533",
                          direction: "ASC",
                        },
                      },
                    ],
                  },
                  tableOptions: {
                    headerStyle: {
                      textWrap: "WRAP",
                      height: 25,
                    },
                  },
                  fieldOptions: {
                    selectedFieldOptions: [
                      {
                        fieldId:
                          "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.0.1689780820533",
                        width: "138px",
                      },
                      {
                        fieldId:
                          "b2ac680d-b919-4a93-b55d-183fbf5abafb.QuestionTitle.1.1689780825034",
                        customLabel: "Question",
                      },
                    ],
                    order: [],
                  },
                },
                actions: [],
              },
            },
            {
              tableVisual: {
                visualId: "568a8e90-3658-4977-b7d8-e80370f624c9",
                title: {
                  visibility: "VISIBLE",
                  formatText: {
                    richText: "<visual-title>Workload Summary</visual-title>",
                  },
                },
                subtitle: {
                  visibility: "VISIBLE",
                },
                chartConfiguration: {
                  fieldWells: {
                    tableAggregatedFieldWells: {
                      groupBy: [
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "b2ac680d-b919-4a93-b55d-183fbf5abafb.WorkloadName.0.1689785704679",
                            column: {
                              dataSetIdentifier: "questionnaire-answers-risks",
                              columnName: "WorkloadName",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "b2ac680d-b919-4a93-b55d-183fbf5abafb.LensName.1.1689785709239",
                            column: {
                              dataSetIdentifier: "questionnaire-answers-risks",
                              columnName: "LensName",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.2.1689785713832",
                            column: {
                              dataSetIdentifier: "questionnaire-answers-risks",
                              columnName: "Risk",
                            },
                          },
                        },
                      ],
                      values: [
                        {
                          categoricalMeasureField: {
                            fieldId:
                              "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.3.1689785717246",
                            column: {
                              dataSetIdentifier: "questionnaire-answers-risks",
                              columnName: "Risk",
                            },
                            aggregationFunction: "COUNT",
                          },
                        },
                      ],
                    },
                  },
                  sortConfiguration: {
                    rowSort: [
                      {
                        fieldSort: {
                          fieldId:
                            "b2ac680d-b919-4a93-b55d-183fbf5abafb.WorkloadName.0.1689785704679",
                          direction: "ASC",
                        },
                      },
                    ],
                  },
                  fieldOptions: {
                    selectedFieldOptions: [
                      {
                        fieldId:
                          "b2ac680d-b919-4a93-b55d-183fbf5abafb.WorkloadName.0.1689785704679",
                        customLabel: "Workload",
                      },
                      {
                        fieldId:
                          "b2ac680d-b919-4a93-b55d-183fbf5abafb.LensName.1.1689785709239",
                        customLabel: "Lens",
                      },
                      {
                        fieldId:
                          "b2ac680d-b919-4a93-b55d-183fbf5abafb.Risk.3.1689785717246",
                        customLabel: "Risk (Count)",
                      },
                    ],
                    order: [],
                  },
                },
                actions: [],
              },
            },
          ],
          layouts: [
            {
              configuration: {
                gridLayout: {
                  elements: [
                    {
                      elementId: "16f358cc-ecdd-4a38-8970-562a74f1b904",
                      elementType: "VISUAL",
                      columnIndex: 0,
                      columnSpan: 18,
                      rowIndex: 0,
                      rowSpan: 12,
                    },
                    {
                      elementId: "b2fadf05-5999-4533-96eb-a1f476d82487",
                      elementType: "VISUAL",
                      columnIndex: 18,
                      columnSpan: 18,
                      rowIndex: 0,
                      rowSpan: 12,
                    },
                    {
                      elementId: "568a8e90-3658-4977-b7d8-e80370f624c9",
                      elementType: "VISUAL",
                      columnSpan: 18,
                      rowSpan: 12,
                    },
                  ],
                  canvasSizeOptions: {
                    screenCanvasSizeOptions: {
                      resizeOption: "FIXED",
                      optimizedViewPortWidth: "1600px",
                    },
                  },
                },
              },
            },
          ],
          contentType: "INTERACTIVE",
        },
        {
          sheetId: "e76d6a84-c0ca-4ecb-9225-e0b75bc66ade",
          name: "Conformance Pack",
          visuals: [
            {
              tableVisual: {
                visualId: "c42bc5ed-67ea-4d6a-b482-32f18351dae3",
                title: {
                  visibility: "VISIBLE",
                  formatText: {
                    richText:
                      "<visual-title>Conformance Pack Compliance Scores</visual-title>",
                  },
                },
                subtitle: {
                  visibility: "VISIBLE",
                },
                chartConfiguration: {
                  fieldWells: {
                    tableAggregatedFieldWells: {
                      groupBy: [
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "dec2da51-2326-49ef-9e53-10ba41d9210f.ConformancePackName.0.1689880062397",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-summary",
                              columnName: "ConformancePackName",
                            },
                          },
                        },
                      ],
                      values: [
                        {
                          numericalMeasureField: {
                            fieldId:
                              "dec2da51-2326-49ef-9e53-10ba41d9210f.Score.1.1689880064599",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-summary",
                              columnName: "Score",
                            },
                            aggregationFunction: {
                              simpleNumericalAggregation: "SUM",
                            },
                          },
                        },
                      ],
                    },
                  },
                  sortConfiguration: {},
                },
                actions: [],
              },
            },
            {
              barChartVisual: {
                visualId: "9ee16f19-2657-4d41-be5a-c47d03910efa",
                title: {
                  visibility: "VISIBLE",
                  formatText: {
                    richText:
                      "<visual-title>Compliance by Resource Type</visual-title>",
                  },
                },
                subtitle: {
                  visibility: "VISIBLE",
                },
                chartConfiguration: {
                  fieldWells: {
                    barChartAggregatedFieldWells: {
                      category: [
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ComplianceType.0.1689880129188",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-detail",
                              columnName: "ResourceType",
                            },
                          },
                        },
                      ],
                      values: [],
                      colors: [
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ComplianceType.1.1689880271217",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-detail",
                              columnName: "ComplianceType",
                            },
                          },
                        },
                      ],
                    },
                  },
                  sortConfiguration: {
                    categorySort: [
                      {
                        fieldSort: {
                          fieldId:
                            "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ComplianceType.0.1689880129188",
                          direction: "DESC",
                        },
                      },
                    ],
                    categoryItemsLimit: {
                      otherCategories: "INCLUDE",
                    },
                    colorItemsLimit: {
                      otherCategories: "INCLUDE",
                    },
                    smallMultiplesLimitConfiguration: {
                      otherCategories: "INCLUDE",
                    },
                  },
                  orientation: "HORIZONTAL",
                  barsArrangement: "STACKED",
                  legend: {
                    width: "160px",
                  },
                  dataLabels: {
                    visibility: "HIDDEN",
                    overlap: "DISABLE_OVERLAP",
                  },
                  tooltip: {
                    tooltipVisibility: "VISIBLE",
                    selectedTooltipType: "BASIC",
                    fieldBasedTooltip: {
                      aggregationVisibility: "HIDDEN",
                      tooltipTitleType: "PRIMARY_VALUE",
                      tooltipFields: [
                        {
                          fieldTooltipItem: {
                            fieldId:
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ComplianceType.0.1689880129188",
                            visibility: "VISIBLE",
                          },
                        },
                        {
                          fieldTooltipItem: {
                            fieldId:
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ComplianceType.1.1689880271217",
                            visibility: "VISIBLE",
                          },
                        },
                      ],
                    },
                  },
                },
                actions: [
                  {
                    customActionId: "28abd4b0-ca4a-485a-bab9-2d51924d716b",
                    name: "Filter Resource Type",
                    status: "ENABLED",
                    trigger: "DATA_POINT_CLICK",
                    actionOperations: [
                      {
                        filterOperation: {
                          selectedFieldsConfiguration: {
                            selectedFields: [
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ComplianceType.0.1689880129188",
                            ],
                          },
                          targetVisualsConfiguration: {
                            sameSheetTargetVisualConfiguration: {
                              targetVisualOptions: "ALL_VISUALS",
                            },
                          },
                        },
                      },
                    ],
                  },
                ],
                columnHierarchies: [],
              },
            },
            {
              tableVisual: {
                visualId: "0023bec5-4bb5-4602-9ef3-fa88f74fbc65",
                title: {
                  visibility: "VISIBLE",
                  formatText: {
                    richText: "<visual-title>Resources</visual-title>",
                  },
                },
                subtitle: {
                  visibility: "VISIBLE",
                },
                chartConfiguration: {
                  fieldWells: {
                    tableAggregatedFieldWells: {
                      groupBy: [
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ResourceType.0.1689880427607",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-detail",
                              columnName: "ResourceType",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ResourceId.1.1689880431703",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-detail",
                              columnName: "ResourceId",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ConformancePackName.4.1692109424917",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-detail",
                              columnName: "ConformancePackName",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ConfigRuleName.2.1689880528663",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-detail",
                              columnName: "ConfigRuleName",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ComplianceType.3.1689880549961",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-detail",
                              columnName: "ComplianceType",
                            },
                          },
                        },
                      ],
                      values: [],
                    },
                  },
                  sortConfiguration: {
                    rowSort: [
                      {
                        fieldSort: {
                          fieldId:
                            "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ResourceType.0.1689880427607",
                          direction: "ASC",
                        },
                      },
                    ],
                  },
                  tableOptions: {
                    headerStyle: {
                      textWrap: "WRAP",
                      height: 25,
                    },
                    cellStyle: {
                      height: 25,
                    },
                  },
                  fieldOptions: {
                    selectedFieldOptions: [
                      {
                        fieldId:
                          "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ResourceId.1.1689880431703",
                        width: "197px",
                      },
                      {
                        fieldId:
                          "2ea17a7d-b71f-4482-b3d9-22a17c8b63df.ConfigRuleName.2.1689880528663",
                        width: "523px",
                      },
                    ],
                    order: [],
                  },
                },
                actions: [],
              },
            },
            {
              tableVisual: {
                visualId: "95bd49a1-505f-41a8-a939-ccd3d936b006",
                title: {
                  visibility: "VISIBLE",
                  formatText: {
                    richText:
                      "<visual-title>Prioritized Remediation</visual-title>",
                  },
                },
                subtitle: {
                  visibility: "VISIBLE",
                },
                chartConfiguration: {
                  fieldWells: {
                    tableAggregatedFieldWells: {
                      groupBy: [
                        {
                          numericalDimensionField: {
                            fieldId:
                              "76931d57-c101-43af-a856-d7e3d733d36f.Rank.3.1692293187198",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-remediation",
                              columnName: "Rank",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "76931d57-c101-43af-a856-d7e3d733d36f.ConfigRuleNamePrefix.0.1692293187198",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-remediation",
                              columnName: "ConfigRuleNamePrefix",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "76931d57-c101-43af-a856-d7e3d733d36f.PlaybookId.1.1692293187198",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-remediation",
                              columnName: "PlaybookId",
                            },
                          },
                        },
                        {
                          categoricalDimensionField: {
                            fieldId:
                              "76931d57-c101-43af-a856-d7e3d733d36f.SkillLevel.4.1694656456320",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-remediation",
                              columnName: "SkillLevel",
                            },
                          },
                        },
                      ],
                      values: [
                        {
                          numericalMeasureField: {
                            fieldId:
                              "76931d57-c101-43af-a856-d7e3d733d36f.LOEHours.2.1692293187198",
                            column: {
                              dataSetIdentifier:
                                "conformance-pack-compliance-remediation",
                              columnName: "LOEHours",
                            },
                            aggregationFunction: {
                              simpleNumericalAggregation: "SUM",
                            },
                          },
                        },
                      ],
                    },
                  },
                  sortConfiguration: {
                    rowSort: [
                      {
                        fieldSort: {
                          fieldId:
                            "76931d57-c101-43af-a856-d7e3d733d36f.Rank.3.1692293187198",
                          direction: "DESC",
                        },
                      },
                    ],
                  },
                  tableOptions: {
                    headerStyle: {
                      textWrap: "WRAP",
                      height: 25,
                    },
                    cellStyle: {
                      height: 25,
                    },
                    rowAlternateColorOptions: {
                      status: "DISABLED",
                      usePrimaryBackgroundColor: "ENABLED",
                    },
                  },
                  fieldOptions: {
                    selectedFieldOptions: [
                      {
                        fieldId:
                          "76931d57-c101-43af-a856-d7e3d733d36f.Rank.3.1692293187198",
                        width: "99px",
                      },
                      {
                        fieldId:
                          "76931d57-c101-43af-a856-d7e3d733d36f.ConfigRuleNamePrefix.0.1692293187198",
                        customLabel: "Config Rule",
                      },
                      {
                        fieldId:
                          "76931d57-c101-43af-a856-d7e3d733d36f.PlaybookId.1.1692293187198",
                        customLabel: "Playbook",
                      },
                      {
                        fieldId:
                          "76931d57-c101-43af-a856-d7e3d733d36f.LOEHours.2.1692293187198",
                        customLabel: "LOE (Hours)",
                      },
                    ],
                    order: [],
                  },
                },
                actions: [],
              },
            },
          ],
          layouts: [
            {
              configuration: {
                gridLayout: {
                  elements: [
                    {
                      elementId: "c42bc5ed-67ea-4d6a-b482-32f18351dae3",
                      elementType: "VISUAL",
                      columnIndex: 0,
                      columnSpan: 8,
                      rowIndex: 0,
                      rowSpan: 12,
                    },
                    {
                      elementId: "9ee16f19-2657-4d41-be5a-c47d03910efa",
                      elementType: "VISUAL",
                      columnIndex: 8,
                      columnSpan: 24,
                      rowIndex: 0,
                      rowSpan: 12,
                    },
                    {
                      elementId: "0023bec5-4bb5-4602-9ef3-fa88f74fbc65",
                      elementType: "VISUAL",
                      columnIndex: 0,
                      columnSpan: 32,
                      rowIndex: 12,
                      rowSpan: 12,
                    },
                    {
                      elementId: "95bd49a1-505f-41a8-a939-ccd3d936b006",
                      elementType: "VISUAL",
                      columnIndex: 0,
                      columnSpan: 23,
                      rowIndex: 24,
                      rowSpan: 15,
                    },
                  ],
                  canvasSizeOptions: {
                    screenCanvasSizeOptions: {
                      resizeOption: "FIXED",
                      optimizedViewPortWidth: "1600px",
                    },
                  },
                },
              },
            },
          ],
          contentType: "INTERACTIVE",
        },
      ],
      calculatedFields: [],
      parameterDeclarations: [],
      filterGroups: [],
      columnConfigurations: [
        {
          column: {
            dataSetIdentifier: "conformance-pack-compliance-remediation",
            columnName: "Rank",
          },
          formatConfiguration: {
            numberFormatConfiguration: {
              formatConfiguration: {
                numberDisplayFormatConfiguration: {
                  separatorConfiguration: {
                    thousandsSeparator: {
                      visibility: "HIDDEN",
                    },
                  },
                  decimalPlacesConfiguration: {
                    decimalPlaces: 2,
                  },
                },
              },
            },
          },
        },
      ],
      analysisDefaults: {
        defaultNewSheetConfiguration: {
          interactiveLayoutConfiguration: {
            grid: {
              canvasSizeOptions: {
                screenCanvasSizeOptions: {
                  resizeOption: "FIXED",
                  optimizedViewPortWidth: "1600px",
                },
              },
            },
          },
          sheetContentType: "INTERACTIVE",
        },
      },
      options: {
        weekStart: "SUNDAY",
      },
    };

    //  QuickSight Analysis
    const analysisId = `${props.application}`;
    const qsAnalysis = new CfnAnalysis(
      this,
      `${analysisId}-quicksight-analysis`,
      {
        analysisId: analysisId,
        awsAccountId: account,
        name: analysisId,
        permissions: [
          {
            actions: [
              "quicksight:DescribeAnalysis",
              "quicksight:DescribeAnalysisPermissions",
              "quicksight:DeleteAnalysis",
              "quicksight:QueryAnalysis",
              "quicksight:RestoreAnalysis",
              "quicksight:UpdateAnalysis",
              "quicksight:UpdateAnalysisPermissions",
            ],
            principal: qsPrincipalArn,
          },
        ],
        definition: qsDefinition,
      }
    );
    qsAnalysis.addDependency(dataset1);
    qsAnalysis.addDependency(dataset2);
    qsAnalysis.addDependency(dataset3);
    qsAnalysis.addDependency(dataset4);

    //  QuickSight Dashboard
    const dashboardId = `${props.application}`;
    const qsDashboard = new CfnDashboard(
      this,
      `${dashboardId}-quicksight-dashboard`,
      {
        dashboardId: dashboardId,
        awsAccountId: account,
        name: dashboardId,
        permissions: [
          {
            actions: [
              "quicksight:DescribeDashboard",
              "quicksight:DescribeDashboardPermissions",
              "quicksight:DeleteDashboard",
              "quicksight:ListDashboardVersions",
              "quicksight:QueryDashboard",
              "quicksight:UpdateDashboard",
              "quicksight:UpdateDashboardPermissions",
              "quicksight:UpdateDashboardPublishedVersion",
            ],
            principal: qsPrincipalArn,
          },
        ],
        definition: qsDefinition,
      }
    );
    qsDashboard.addDependency(dataset1);
    qsDashboard.addDependency(dataset2);
    qsDashboard.addDependency(dataset3);
    qsDashboard.addDependency(dataset4);
  }
}
