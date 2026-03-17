#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { FintrackStack, FintrackCertStack } from "../lib/fintrack-stack";

// --- CONFIGURE THESE FOR YOUR DEPLOYMENT ---
const ACCOUNT = process.env.CDK_DEFAULT_ACCOUNT || "YOUR_AWS_ACCOUNT_ID";
const DOMAIN_NAME = process.env.FINTRACK_DOMAIN || "fintrack.example.com";
const HOSTED_ZONE_ID = process.env.FINTRACK_HOSTED_ZONE_ID || "YOUR_HOSTED_ZONE_ID";
const ZONE_NAME = process.env.FINTRACK_ZONE_NAME || "example.com";

const app = new cdk.App();

// ACM certificate must be in us-east-1 for CloudFront
const certStack = new FintrackCertStack(app, "FintrackCertStack", {
  env: { account: ACCOUNT, region: "us-east-1" },
  crossRegionReferences: true,
  domainName: DOMAIN_NAME,
  hostedZoneId: HOSTED_ZONE_ID,
  zoneName: ZONE_NAME,
});

// Main stack in eu-west-2
new FintrackStack(app, "FintrackStack", {
  env: { account: ACCOUNT, region: "eu-west-2" },
  crossRegionReferences: true,
  certificate: certStack.certificate,
  domainName: DOMAIN_NAME,
});
