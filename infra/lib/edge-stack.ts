import * as cdk from "aws-cdk-lib";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";

/**
 * Resources CloudFront requires in us-east-1, regardless of where the app runs.
 * Currently just the WAF web ACL: a per-IP rate limit on /api/* to protect AI spend.
 */
export class LedgerMatchEdgeStack extends cdk.Stack {
  readonly webAcl: wafv2.CfnWebACL;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "LedgerMatchWebAcl",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "ApiRateLimitPerIp",
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              // Requests per 5-minute window per client IP.
              limit: 100,
              aggregateKeyType: "IP",
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: "STARTS_WITH",
                  searchString: "/api/",
                  textTransformations: [{ priority: 0, type: "NONE" }],
                },
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "ApiRateLimitPerIp",
            sampledRequestsEnabled: true,
          },
        },
        {
          name: "AmazonIpReputationList",
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesAmazonIpReputationList",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AmazonIpReputationList",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
  }
}
