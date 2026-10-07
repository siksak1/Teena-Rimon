import serverlessExpress from "@codegenie/serverless-express";
import { app } from "./app.js";

/** AWS Lambda entry point (invoked via Function URL behind CloudFront). */
export const handler = serverlessExpress({ app });
