import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface LedgerMatchStackProps extends cdk.StackProps {
  /** Custom domain, e.g. app.example.com. Requires certificateArn. */
  domainName?: string;
  /** ACM certificate ARN in us-east-1 covering domainName. */
  certificateArn?: string;
  /** The AI fallback (backend/): alert e-mails, thresholds and limits. See DEPLOY.md. */
  ai: {
    /** Where alert e-mails go (SNS asks to confirm the subscription once). Empty: no e-mails. */
    alertEmail?: string;
    /** Monthly AI-call counts (all customers) that each send one e-mail, e.g. "25,50,100". */
    alertThresholds: string;
    /** Also e-mail each time a supplier format is learned for the first time. */
    alertNewFormats: boolean;
    /** AI calls one customer may make per day. */
    dailyLimit: number;
    /** AWS Budgets alert for the whole account, in US dollars a month. */
    monthlyBudgetUsd: number;
  };
}

/** SSM SecureString holding the Anthropic API key; created by hand (DEPLOY.md), never by CDK or in git. */
export const API_KEY_PARAMETER = "/ledgermatch/anthropic-api-key";

/**
 * CSP (own files, the analytics endpoint and the AI backend only), noindex, no referrer —
 * shared with the end-to-end test server, so tests run under these exact headers.
 */
const HEADERS: {
  contentSecurityPolicy: string[];
  robots: string;
  referrerPolicy: string;
  permissionsPolicy: string;
} = JSON.parse(readFileSync(new URL("../security-headers.json", import.meta.url), "utf8"));
if (HEADERS.referrerPolicy !== "no-referrer") throw new Error("security-headers.json: referrerPolicy must stay no-referrer");

/**
 * Static hosting for every customer's build, with no server code:
 *
 *   Browser ──► CloudFront ──(viewer-request Function + KeyValueStore)──► private S3
 *   /<secret token>/…          token → {slug, build}                    /builds/<slug>/<build>/…
 *
 * Builds are uploaded and tokens are managed by scripts/release.sh and
 * scripts/token.sh — neither builds nor tokens are part of this stack, so a
 * redeploy never changes what a customer sees, and tokens never enter git.
 */
export class LedgerMatchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LedgerMatchStackProps) {
    super(scope, id, props);

    if (Boolean(props.domainName) !== Boolean(props.certificateArn)) {
      throw new Error("domainName and certificateArn must be set together.");
    }

    // Holds builds/<slug>/<build>/… — every release ever made, for instant
    // rollback. Retained if the stack is deleted, so releases are never lost.
    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Secret token → {slug, build}. Filled by scripts/token.sh, never by CDK.
    const routes = new cloudfront.KeyValueStore(this, "Routes", {
      comment: "LedgerMatch: customer URL token -> build",
    });

    const routeFunction = new cloudfront.Function(this, "RouteFunction", {
      comment: "Maps /<token>/ to the customer's build; 404 for anything else",
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      keyValueStore: routes,
      code: cloudfront.FunctionCode.fromInline(
        readFileSync(new URL("../functions/route.js", import.meta.url), "utf8").replace(
          "__KVS_ID__",
          routes.keyValueStoreId,
        ),
      ),
    });

    const ai = this.aiBackend(props, routes);

    const headers = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      comment: "LedgerMatch: CSP (analytics and AI backend only), noindex, no referrer",
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          // The page may send an invoice to the AI backend (only when no reader in the browser can read it).
          contentSecurityPolicy: HEADERS.contentSecurityPolicy.join("; ").replace(AI_ENDPOINT, ai.url),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: "X-Robots-Tag", value: HEADERS.robots, override: true },
          { header: "Permissions-Policy", value: HEADERS.permissionsPolicy, override: true },
        ],
      },
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "LedgerMatch",
      // No default root object and no error pages: "/" is a plain 404 from the function.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate: props.certificateArn
        ? acm.Certificate.fromCertificateArn(this, "Certificate", props.certificateArn)
        : undefined,
      // Standard access logs stay off: they would record the secret tokens.
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        // The cache key is the rewritten /builds/<slug>/<build>/… path, and a
        // build is never overwritten, so nothing ever needs invalidating.
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        functionAssociations: [
          { function: routeFunction, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
    });

    new cdk.CfnOutput(this, "SiteHost", {
      value: props.domainName ?? distribution.distributionDomainName,
      description: "Customer URLs are https://<SiteHost>/<token>/",
    });
    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
      description: "Point a custom domain's CNAME / alias record here",
    });
    new cdk.CfnOutput(this, "BucketName", { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, "RoutesArn", { value: routes.keyValueStoreArn });
  }

  /**
   * The AI fallback (backend/src/handler.ts): a Lambda behind a Function URL
   * (an AI call can outlast CloudFront's 60-second origin timeout), the
   * learned-layouts and usage table, alert e-mails, and a budget alarm.
   * Customers' secret tokens are checked against the same KeyValueStore.
   */
  private aiBackend(props: LedgerMatchStackProps, routes: cloudfront.KeyValueStore): lambda.FunctionUrl {
    // Learned supplier layouts and usage counters; no invoice data. Retained if the stack is deleted.
    const table = new dynamodb.TableV2(this, "AiTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const alerts = new sns.Topic(this, "AlertTopic", { displayName: "LedgerMatch alerts" });
    if (props.ai.alertEmail) alerts.addSubscription(new subscriptions.EmailSubscription(props.ai.alertEmail));

    const logGroup = new logs.LogGroup(this, "AiLogs", {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fn = new nodejs.NodejsFunction(this, "AiFunction", {
      description: "LedgerMatch AI fallback: learned supplier layouts and Claude",
      entry: fileURLToPath(new URL("../../backend/src/handler.ts", import.meta.url)),
      projectRoot: fileURLToPath(new URL("../../backend/", import.meta.url)),
      depsLockFilePath: fileURLToPath(new URL("../../backend/package-lock.json", import.meta.url)),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(300),
      logGroup,
      environment: {
        TABLE: table.tableName,
        KVS_ARN: routes.keyValueStoreArn,
        ALERT_TOPIC_ARN: alerts.topicArn,
        API_KEY_PARAMETER,
        AI_ALERT_THRESHOLDS: props.ai.alertThresholds,
        ALERT_NEW_FORMATS: props.ai.alertNewFormats ? "1" : "0",
        AI_DAILY_LIMIT: String(props.ai.dailyLimit),
        AI_EFFORT: "low",
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node22",
        sourceMap: true,
        // The pure-JavaScript SigV4A signer is not in the Lambda runtime's SDK: bundle the SDK.
        bundleAwsSDK: true,
        // Only the parsers' text code runs here; never pdf.js or OCR.
        externalModules: ["pdfjs-dist", "@napi-rs/canvas", "tesseract-wasm"],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    });
    table.grantReadWriteData(fn);
    alerts.grantPublish(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["cloudfront-keyvaluestore:GetKey"], resources: [routes.keyValueStoreArn] }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [this.formatArn({ service: "ssm", resource: "parameter", resourceName: API_KEY_PARAMETER.slice(1) })],
      }),
    );

    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // the customer's secret token is checked in the handler
      cors: {
        // A custom domain is known here; the CloudFront domain is not (it would be a cycle). The token is the access check.
        allowedOrigins: props.domainName ? [`https://${props.domainName}`] : ["*"],
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
        allowedHeaders: ["content-type", "x-customer-token"],
        maxAge: cdk.Duration.hours(1),
      },
    });

    if (props.ai.alertEmail) {
      new budgets.CfnBudget(this, "MonthlyBudget", {
        budget: {
          budgetName: "LedgerMatch monthly",
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: props.ai.monthlyBudgetUsd, unit: "USD" },
        },
        notificationsWithSubscribers: [
          {
            notification: { notificationType: "ACTUAL", comparisonOperator: "GREATER_THAN", threshold: 80 },
            subscribers: [{ subscriptionType: "EMAIL", address: props.ai.alertEmail }],
          },
          {
            notification: { notificationType: "FORECASTED", comparisonOperator: "GREATER_THAN", threshold: 100 },
            subscribers: [{ subscriptionType: "EMAIL", address: props.ai.alertEmail }],
          },
        ],
      });
    }

    new cdk.CfnOutput(this, "AiEndpoint", { value: url.url, description: "VITE_AI_ENDPOINT for builds (scripts/release.sh)" });
    new cdk.CfnOutput(this, "AiTableName", { value: table.tableName, description: "scripts/formats.sh reads it" });
    new cdk.CfnOutput(this, "AlertTopicArn", { value: alerts.topicArn });
    return url;
  }
}

/** Placeholder in security-headers.json for the AI backend's origin (the Function URL, or the e2e fake). */
const AI_ENDPOINT = "__AI_ENDPOINT__";
