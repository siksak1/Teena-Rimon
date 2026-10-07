import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const backendDir = path.join(repoRoot, "backend");
const frontendDist = path.join(repoRoot, "frontend", "dist");

export interface LedgerMatchStackProps extends cdk.StackProps {
  /** WAF web ACL ARN from the us-east-1 edge stack; omit to run without WAF. */
  webAclArn?: string;
  /** Custom domain, e.g. app.example.com. Requires certificateArn. */
  domainName?: string;
  /** ACM certificate ARN in us-east-1 covering domainName. */
  certificateArn?: string;
}

export class LedgerMatchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LedgerMatchStackProps) {
    super(scope, id, props);

    if (!existsSync(path.join(frontendDist, "index.html"))) {
      throw new Error(
        `Frontend build not found at ${frontendDist}. Run "npm run build --prefix frontend" first.`,
      );
    }
    if (Boolean(props.domainName) !== Boolean(props.certificateArn)) {
      throw new Error("domainName and certificateArn must be set together.");
    }

    // ── Backend: Express app on Lambda, reachable only through CloudFront ──

    // CloudFront sends this value in a header; the Lambda rejects requests
    // without it, so the raw Function URL is useless if discovered.
    const originVerifySecret = new secretsmanager.Secret(this, "OriginVerifySecret", {
      description: "Shared header value between CloudFront and the extract Lambda",
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
    });
    const originVerifyValue = originVerifySecret.secretValue.unsafeUnwrap();

    const extractFn = new nodejs.NodejsFunction(this, "ExtractFunction", {
      entry: path.join(backendDir, "src", "lambda.ts"),
      handler: "handler",
      // Repo root, so the bundle can include the shared ../core package.
      projectRoot: repoRoot,
      depsLockFilePath: path.join(backendDir, "package-lock.json"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      // CloudFront gives up at 60s (originReadTimeout below); the extra
      // headroom lets the function log a slow parse instead of being cut off.
      timeout: cdk.Duration.seconds(90),
      environment: {
        NODE_ENV: "production",
        ORIGIN_VERIFY_SECRET: originVerifyValue,
      },
      logGroup: new logs.LogGroup(this, "ExtractFunctionLogs", {
        logGroupName: "/ledgermatch/extract",
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      bundling: { target: "node22", minify: true, sourceMap: true },
    });

    const extractUrl = extractFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // ── Frontend: private S3 bucket served by CloudFront ──

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "LedgerMatch",
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate: props.certificateArn
        ? acm.Certificate.fromCertificateArn(this, "Certificate", props.certificateArn)
        : undefined,
      webAclId: props.webAclArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.FunctionUrlOrigin(extractUrl, {
            readTimeout: cdk.Duration.seconds(60),
            customHeaders: { "x-origin-verify": originVerifyValue },
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Function URLs reject a forwarded viewer Host header.
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    });

    // Future: when customers onboard, add a Cognito user pool here and verify
    // its JWT in backend/src/app.ts before /api/extract runs.

    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset(frontendDist)],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
      memoryLimit: 512,
    });

    new cdk.CfnOutput(this, "SiteUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "Open this URL to use the app",
    });
    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: distribution.distributionDomainName,
      description: "Point your custom domain's CNAME / alias record here",
    });
  }
}
