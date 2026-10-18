# Creates the legacy DynamoDB state lock table once (run on the moto node).
import boto3
ddb = boto3.client("dynamodb", endpoint_url="http://localhost:5000", region_name="eu-west-2",
                   aws_access_key_id="saltmarsh-lab", aws_secret_access_key="saltmarsh-lab-secret")
if "sm-trading-tflocks" not in ddb.list_tables()["TableNames"]:
    ddb.create_table(TableName="sm-trading-tflocks", BillingMode="PAY_PER_REQUEST",
                     AttributeDefinitions=[{"AttributeName": "LockID", "AttributeType": "S"}],
                     KeySchema=[{"AttributeName": "LockID", "KeyType": "HASH"}])
