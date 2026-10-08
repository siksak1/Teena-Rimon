import * as cdk from "aws-cdk-lib";
import { LedgerMatchStack } from "../lib/ledgermatch-stack.js";

const app = new cdk.App();
const context = (key: string) => app.node.tryGetContext(key);

new LedgerMatchStack(app, "LedgerMatchStatic", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: context("region") || "eu-central-1" },
  domainName: context("domainName") || undefined,
  certificateArn: context("certificateArn") || undefined,
});
