services = {
  collector = { port = {{cport}}, allowed_from = ["ingest", "edge-gateway"] }
  historian = { port = 5432, allowed_from = ["collector"] }
  alerting  = { port = 9093, allowed_from = ["collector", "historian", "{{console}}"] }
}
