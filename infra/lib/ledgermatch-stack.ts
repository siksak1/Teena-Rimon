import { readFileSync } from "node:fs";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

export interface LedgerMatchStackProps extends cdk.StackProps {
  /** Custom domain, e.g. app.example.com. Requires certificateArn. */
  domainName?: string;
  /** ACM certificate ARN in us-east-1 covering domainName. */
  certificateArn?: string;
}

/** The only origin the app may contact (usage analytics); see frontend/src/analytics.ts. */
const ANALYTICS_ORIGIN = "https://eu.i.posthog.com";

/**
 * Invoice files are parsed in the browser, so the page may only load its own
 * files and talk to the analytics endpoint — nothing else, even by mistake.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  `connect-src ${ANALYTICS_ORIGIN}`,
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const NOINDEX = "noindex, nofollow, noarchive";

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

    const headers = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      comment: "LedgerMatch: CSP (analytics only), noindex, no referrer",
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: CONTENT_SECURITY_POLICY, override: true },
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
          { header: "X-Robots-Tag", value: NOINDEX, override: true },
          { header: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()", override: true },
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
}
