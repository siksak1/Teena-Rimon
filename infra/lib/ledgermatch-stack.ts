import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
    });

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
