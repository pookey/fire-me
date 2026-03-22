#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load local config from .env (AWS_PROFILE, domain, etc.)
# shellcheck disable=SC1091
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

PROFILE="${AWS_PROFILE:-default}"
REGION="eu-west-2"

echo "=========================================="
echo "  FinTrack Deploy"
echo "=========================================="
echo ""

# ------------------------------------------
# Step 1: Build backend
# ------------------------------------------
echo "▸ Building backend Lambda functions..."
cd "$ROOT_DIR/backend"
npm ci --silent
npm run build
echo "  ✓ Backend built"
echo ""

# ------------------------------------------
# Step 2: Deploy infrastructure (CDK)
# ------------------------------------------
echo "▸ Deploying infrastructure..."
cd "$ROOT_DIR/infrastructure"
npm ci --silent

# Bootstrap CDK if not already done (both regions)
echo "  Bootstrapping CDK (us-east-1 for cert, eu-west-2 for main)..."
AWS_ACCOUNT=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
npx cdk bootstrap "aws://$AWS_ACCOUNT/us-east-1" --profile "$PROFILE" 2>/dev/null || true
npx cdk bootstrap "aws://$AWS_ACCOUNT/eu-west-2" --profile "$PROFILE" 2>/dev/null || true

echo "  Deploying stacks (cert + main)..."
npx cdk deploy --all \
  --profile "$PROFILE" \
  --require-approval never \
  --outputs-file "$ROOT_DIR/cdk-outputs.json"

echo "  ✓ Infrastructure deployed"
echo ""

# ------------------------------------------
# Step 3: Extract outputs
# ------------------------------------------
echo "▸ Reading stack outputs..."

API_URL=$(jq -r '.FintrackStack.ApiUrl' "$ROOT_DIR/cdk-outputs.json")
USER_POOL_ID=$(jq -r '.FintrackStack.UserPoolId' "$ROOT_DIR/cdk-outputs.json")
USER_POOL_CLIENT_ID=$(jq -r '.FintrackStack.UserPoolClientId' "$ROOT_DIR/cdk-outputs.json")
BUCKET_NAME=$(jq -r '.FintrackStack.FrontendBucketName' "$ROOT_DIR/cdk-outputs.json")
DISTRIBUTION_ID=$(jq -r '.FintrackStack.CloudFrontDistributionId' "$ROOT_DIR/cdk-outputs.json")

echo "  API URL:          $API_URL"
echo "  User Pool ID:     $USER_POOL_ID"
echo "  Client ID:        $USER_POOL_CLIENT_ID"
echo "  S3 Bucket:        $BUCKET_NAME"
echo "  Distribution ID:  $DISTRIBUTION_ID"
echo ""

# ------------------------------------------
# Step 4: Build frontend with real config
# ------------------------------------------
echo "▸ Building frontend..."
cd "$ROOT_DIR/frontend"
npm ci --silent

# Write env file with real values from CDK outputs
cat > .env.production <<EOF
VITE_API_URL=$API_URL
VITE_USER_POOL_ID=$USER_POOL_ID
VITE_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
EOF

npm run build
echo "  ✓ Frontend built"
echo ""

# ------------------------------------------
# Step 5: Deploy frontend to S3
# ------------------------------------------
echo "▸ Uploading frontend to S3..."
aws s3 sync dist/ "s3://$BUCKET_NAME/" \
  --delete \
  --profile "$PROFILE" \
  --region "$REGION"
echo "  ✓ Frontend uploaded"
echo ""

# ------------------------------------------
# Step 6: Invalidate CloudFront cache
# ------------------------------------------
echo "▸ Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --profile "$PROFILE" \
  --query 'Invalidation.Id' \
  --output text
echo "  ✓ Cache invalidation started"
echo ""

# ------------------------------------------
# Step 7: Create Cognito user (if first deploy)
# ------------------------------------------
echo "▸ Checking for existing Cognito users..."
USER_COUNT=$(aws cognito-idp list-users \
  --user-pool-id "$USER_POOL_ID" \
  --profile "$PROFILE" \
  --region "$REGION" \
  --query 'Users | length(@)' \
  --output text)

if [ "$USER_COUNT" = "0" ]; then
  echo "  No users found. Create one now?"
  echo -n "  Email: "
  read -r USER_EMAIL
  echo -n "  Password (min 8 chars): "
  read -rs USER_PASSWORD
  echo ""

  aws cognito-idp sign-up \
    --client-id "$USER_POOL_CLIENT_ID" \
    --username "$USER_EMAIL" \
    --password "$USER_PASSWORD" \
    --profile "$PROFILE" \
    --region "$REGION" > /dev/null

  aws cognito-idp admin-confirm-sign-up \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USER_EMAIL" \
    --profile "$PROFILE" \
    --region "$REGION" > /dev/null

  echo "  ✓ User $USER_EMAIL created and confirmed"

  # Save username to .env for fire-advisor skill
  if grep -q '^COGNITO_USERNAME=' "$ROOT_DIR/.env" 2>/dev/null; then
    sed -i '' "s|^COGNITO_USERNAME=.*|COGNITO_USERNAME=$USER_EMAIL|" "$ROOT_DIR/.env"
  else
    echo "COGNITO_USERNAME=$USER_EMAIL" >> "$ROOT_DIR/.env"
  fi
else
  echo "  Found $USER_COUNT existing user(s), skipping"
fi
echo ""

# ------------------------------------------
# Auto-populate .env with deploy outputs
# ------------------------------------------
echo "▸ Updating .env with deploy outputs..."
update_env() {
  local key="$1" value="$2" file="$ROOT_DIR/.env"
  touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i '' "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}
update_env "API_BASE_URL" "$API_URL"
update_env "COGNITO_CLIENT_ID" "$USER_POOL_CLIENT_ID"
echo "  ✓ .env updated (API_BASE_URL, COGNITO_CLIENT_ID)"
echo ""

# ------------------------------------------
# Done!
# ------------------------------------------
echo "=========================================="
echo "  ✓ Deployment complete!"
echo ""
echo "  Done!"
echo "  📡 API: $API_URL"
echo "=========================================="
