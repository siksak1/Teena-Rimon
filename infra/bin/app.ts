import * as cdk from "aws-cdk-lib";
import { LedgerMatchStack } from "../lib/ledgermatch-stack.js";

const app = new cdk.App();
const context = (key: string) => app.node.tryGetContext(key);

new LedgerMatchStack(app, "LedgerMatchStatic", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: context("region") || "eu-central-1" },
  domainName: context("domainName") || undefined,
  certificateArn: context("certificateArn") || undefined,
  siteHost: context("siteHost") || undefined,
  ai: {
    alertEmail: context("alertEmail") || undefined,
    alertThresholds: String(context("aiAlertThresholds") ?? "25,50,100"),
    alertNewFormats: context("aiAlertNewFormats") !== false && context("aiAlertNewFormats") !== "false",
    dailyLimit: Number(context("aiDailyLimit") ?? 30),
    monthlyBudgetUsd: Number(context("monthlyBudgetUsd") ?? 20),
  },
});
