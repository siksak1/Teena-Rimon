import * as cdk from "aws-cdk-lib";
import { LedgerMatchEdgeStack } from "../lib/edge-stack.js";
import { LedgerMatchStack } from "../lib/ledgermatch-stack.js";

const app = new cdk.App();

const context = (key: string) => app.node.tryGetContext(key);
const flag = (key: string) => String(context(key)) === "true";

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region: string = context("region") || "eu-central-1";

// CloudFront-scoped WAF must live in us-east-1, so it gets its own small stack.
const edge = flag("enableWaf")
  ? new LedgerMatchEdgeStack(app, "LedgerMatchEdge", {
      env: { account, region: "us-east-1" },
      crossRegionReferences: true,
    })
  : undefined;

new LedgerMatchStack(app, "LedgerMatch", {
  env: { account, region },
  crossRegionReferences: true,
  webAclArn: edge?.webAcl.attrArn,
  domainName: context("domainName") || undefined,
  certificateArn: context("certificateArn") || undefined,
});
