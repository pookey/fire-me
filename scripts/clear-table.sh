#!/bin/bash
# Delete all items from FinTrack table using batch-write-item (25 at a time)
PROFILE="${AWS_PROFILE:-default}"
REGION="eu-west-2"
TABLE="FinTrack"

echo "Scanning all items..."
ITEMS=$(aws dynamodb scan --table-name $TABLE --projection-expression "pk, sk" --profile $PROFILE --region $REGION --output json | jq -c '.Items[]')

COUNT=$(echo "$ITEMS" | wc -l | tr -d ' ')
echo "Found $COUNT items to delete"

# Build batches of 25 delete requests
BATCH=()
BATCH_NUM=0

while IFS= read -r item; do
  BATCH+=("$item")

  if [ ${#BATCH[@]} -eq 25 ]; then
    BATCH_NUM=$((BATCH_NUM + 1))
    REQUESTS=$(printf '%s\n' "${BATCH[@]}" | jq -s '[.[] | {"DeleteRequest": {"Key": .}}]')
    aws dynamodb batch-write-item \
      --request-items "{\"$TABLE\": $REQUESTS}" \
      --profile $PROFILE --region $REGION > /dev/null
    echo "  Batch $BATCH_NUM: deleted 25 items"
    BATCH=()
  fi
done <<< "$ITEMS"

# Handle remaining items
if [ ${#BATCH[@]} -gt 0 ]; then
  BATCH_NUM=$((BATCH_NUM + 1))
  REQUESTS=$(printf '%s\n' "${BATCH[@]}" | jq -s '[.[] | {"DeleteRequest": {"Key": .}}]')
  aws dynamodb batch-write-item \
    --request-items "{\"$TABLE\": $REQUESTS}" \
    --profile $PROFILE --region $REGION > /dev/null
  echo "  Batch $BATCH_NUM: deleted ${#BATCH[@]} items"
fi

echo "Done! Deleted $COUNT items in $BATCH_NUM batches."
