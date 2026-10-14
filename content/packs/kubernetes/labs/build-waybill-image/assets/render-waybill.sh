#!/bin/sh
# Renders a plain-text waybill and serves it over HTTP.
set -eu
mkdir -p /opt/waybill/www
{
  echo "QUILLMOOR LOGISTICS - WAYBILL"
  echo "shipment: ${SHIPMENT}"
  echo "status: WAYBILL OK"
} > /opt/waybill/www/index.html
cat /opt/waybill/www/index.html
exec httpd -f -p 8080 -h /opt/waybill/www
