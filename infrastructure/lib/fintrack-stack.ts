import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53targets from "aws-cdk-lib/aws-route53-targets";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigwv2authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as path from "path";

interface FintrackStackProps extends cdk.StackProps {
  certificate: acm.ICertificate;
  domainName: string;
}

export class FintrackCertStack extends cdk.Stack {
  public readonly certificate: acm.Certificate;

  constructor(scope: Construct, id: string, props: cdk.StackProps & { domainName: string; hostedZoneId: string; zoneName: string }) {
    super(scope, id, props);

    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.zoneName,
    });

    this.certificate = new acm.Certificate(this, "FinTrackCert", {
      domainName: props.domainName,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
  }
}

export class FintrackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FintrackStackProps) {
    super(scope, id, props);

    const domainName = props.domainName;

    // -------------------------------------------------------
    // DynamoDB Table
    // -------------------------------------------------------
    const table = new dynamodb.Table(this, "FinTrackTable", {
      tableName: "FinTrack",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
    });

    // -------------------------------------------------------
    // Cognito User Pool
    // -------------------------------------------------------
    const userPool = new cognito.UserPool(this, "FinTrackUsers", {
      userPoolName: "FinTrackUsers",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient("FinTrackWebClient", {
      userPoolClientName: "FinTrackWebClient",
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
      },
    });

    // -------------------------------------------------------
    // Lambda Functions
    // -------------------------------------------------------
    const handlersPath = path.join(__dirname, "../../backend/dist/handlers");

    const defaultLambdaProps: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        TABLE_NAME: table.tableName,
      },
    };

    const fundsHandler = new lambda.Function(this, "FundsHandler", {
      ...defaultLambdaProps,
      functionName: "FinTrack-FundsHandler",
      handler: "funds.handler",
      code: lambda.Code.fromAsset(handlersPath),
    } as lambda.FunctionProps);

    const snapshotsHandler = new lambda.Function(this, "SnapshotsHandler", {
      ...defaultLambdaProps,
      functionName: "FinTrack-SnapshotsHandler",
      handler: "snapshots.handler",
      code: lambda.Code.fromAsset(handlersPath),
    } as lambda.FunctionProps);

    const fireConfigHandler = new lambda.Function(this, "FireConfigHandler", {
      ...defaultLambdaProps,
      functionName: "FinTrack-FireConfigHandler",
      handler: "fireConfig.handler",
      code: lambda.Code.fromAsset(handlersPath),
    } as lambda.FunctionProps);

    const importHandler = new lambda.Function(this, "ImportHandler", {
      ...defaultLambdaProps,
      functionName: "FinTrack-ImportHandler",
      handler: "import.handler",
      code: lambda.Code.fromAsset(handlersPath),
      timeout: cdk.Duration.seconds(60),
    } as lambda.FunctionProps);

    const incomeExpensesHandler = new lambda.Function(this, "IncomeExpensesHandler", {
      ...defaultLambdaProps,
      functionName: "FinTrack-IncomeExpensesHandler",
      handler: "incomeExpenses.handler",
      code: lambda.Code.fromAsset(handlersPath),
    } as lambda.FunctionProps);

    // Grant DynamoDB read/write to all lambdas
    table.grantReadWriteData(fundsHandler);
    table.grantReadWriteData(snapshotsHandler);
    table.grantReadWriteData(fireConfigHandler);
    table.grantReadWriteData(importHandler);
    table.grantReadWriteData(incomeExpensesHandler);

    // -------------------------------------------------------
    // HTTP API Gateway
    // -------------------------------------------------------
    const authorizer = new apigwv2authorizers.HttpUserPoolAuthorizer(
      "FinTrackAuthorizer",
      userPool,
      {
        userPoolClients: [userPoolClient],
      }
    );

    const httpApi = new apigwv2.HttpApi(this, "FinTrackApi", {
      apiName: "FinTrackApi",
      corsPreflight: {
        allowOrigins: [`https://${domainName}`],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["Authorization", "Content-Type"],
      },
      defaultAuthorizer: authorizer,
    });

    // Funds routes
    const fundsIntegration = new apigwv2integrations.HttpLambdaIntegration(
      "FundsIntegration",
      fundsHandler
    );
    httpApi.addRoutes({
      path: "/funds",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: fundsIntegration,
    });
    httpApi.addRoutes({
      path: "/funds/{id}",
      methods: [apigwv2.HttpMethod.PUT],
      integration: fundsIntegration,
    });

    // Snapshots routes
    const snapshotsIntegration = new apigwv2integrations.HttpLambdaIntegration(
      "SnapshotsIntegration",
      snapshotsHandler
    );
    httpApi.addRoutes({
      path: "/funds/{id}/snapshots",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: snapshotsIntegration,
    });
    httpApi.addRoutes({
      path: "/funds/{id}/snapshots/{date}",
      methods: [apigwv2.HttpMethod.DELETE],
      integration: snapshotsIntegration,
    });
    httpApi.addRoutes({
      path: "/snapshots/batch",
      methods: [apigwv2.HttpMethod.POST],
      integration: snapshotsIntegration,
    });
    httpApi.addRoutes({
      path: "/snapshots",
      methods: [apigwv2.HttpMethod.GET],
      integration: snapshotsIntegration,
    });

    // FIRE config routes
    const fireConfigIntegration = new apigwv2integrations.HttpLambdaIntegration(
      "FireConfigIntegration",
      fireConfigHandler
    );
    httpApi.addRoutes({
      path: "/fire-config",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.PUT],
      integration: fireConfigIntegration,
    });
    httpApi.addRoutes({
      path: "/fire-scenarios",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: fireConfigIntegration,
    });
    httpApi.addRoutes({
      path: "/fire-scenarios/{id}",
      methods: [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration: fireConfigIntegration,
    });

    // Income & Expenses routes
    const incomeExpensesIntegration = new apigwv2integrations.HttpLambdaIntegration(
      "IncomeExpensesIntegration",
      incomeExpensesHandler
    );
    httpApi.addRoutes({
      path: "/income",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: incomeExpensesIntegration,
    });
    httpApi.addRoutes({
      path: "/income/{id}",
      methods: [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration: incomeExpensesIntegration,
    });
    httpApi.addRoutes({
      path: "/expenses",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: incomeExpensesIntegration,
    });
    httpApi.addRoutes({
      path: "/expenses/{id}",
      methods: [apigwv2.HttpMethod.PUT, apigwv2.HttpMethod.DELETE],
      integration: incomeExpensesIntegration,
    });

    // Import route
    const importIntegration = new apigwv2integrations.HttpLambdaIntegration(
      "ImportIntegration",
      importHandler
    );
    httpApi.addRoutes({
      path: "/import",
      methods: [apigwv2.HttpMethod.POST],
      integration: importIntegration,
    });

    // -------------------------------------------------------
    // S3 + CloudFront (Frontend hosting)
    // -------------------------------------------------------
    const hostedZone = route53.HostedZone.fromLookup(this, "Zone", {
      domainName: domainName.split('.').slice(1).join('.'),
    });

    const websiteBucket = new s3.Bucket(this, "FinTrackFrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "FinTrackOAI",
      {
        comment: "OAI for FinTrack frontend",
      }
    );

    websiteBucket.grantRead(originAccessIdentity);

    const distribution = new cloudfront.Distribution(
      this,
      "FinTrackDistribution",
      {
        defaultBehavior: {
          origin: new origins.S3Origin(websiteBucket, {
            originAccessIdentity,
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        domainNames: [domainName],
        certificate: props.certificate,
        defaultRootObject: "index.html",
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: cdk.Duration.minutes(5),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: cdk.Duration.minutes(5),
          },
        ],
      }
    );

    // DNS record pointing domain → CloudFront
    new route53.ARecord(this, "FinTrackAliasRecord", {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(distribution)
      ),
    });

    // -------------------------------------------------------
    // Stack Outputs
    // -------------------------------------------------------
    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
      description: "HTTP API Gateway URL",
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
      description: "Cognito User Pool ID",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
      description: "Cognito User Pool Client ID",
    });

    new cdk.CfnOutput(this, "CloudFrontUrl", {
      value: `https://${domainName}`,
      description: "CloudFront Distribution URL",
    });

    new cdk.CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
      description: "CloudFront Distribution ID",
    });

    new cdk.CfnOutput(this, "FrontendBucketName", {
      value: websiteBucket.bucketName,
      description: "S3 Bucket for frontend assets",
    });
  }
}
