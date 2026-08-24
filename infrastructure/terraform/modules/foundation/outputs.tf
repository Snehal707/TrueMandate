output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

output "environment" {
  value = var.environment
}

output "name_prefix" {
  value = local.name_prefix
}

output "firestore_database" {
  value = google_firestore_database.primary.name
}

output "artifact_registry_repository" {
  value = google_artifact_registry_repository.truemandate.name
}

output "artifact_registry_repo_id" {
  value = var.artifact_registry_repo_id
}

output "service_account_emails" {
  value = {
    for k, sa in google_service_account.runtime : k => sa.email
  }
}

output "pubsub_topic_names" {
  value = {
    for k, t in google_pubsub_topic.domain : k => t.name
  }
}

output "enable_pull_subscriptions" {
  value = var.enable_pull_subscriptions
}

output "pubsub_pull_subscription_names" {
  value = {
    for k, s in google_pubsub_subscription.consumer : k => s.name
  }
}

output "pubsub_subscription_names" {
  description = "Deprecated alias of pull names; empty when pull is disabled. Runtime push is driven by consumer_topics."
  value = {
    for k, s in google_pubsub_subscription.consumer : k => s.name
  }
}

output "secret_ids" {
  value = {
    for k, s in google_secret_manager_secret.placeholders : k => s.secret_id
  }
}

output "model_armor_template_name" {
  value = google_model_armor_template.tm_prompt_response.name
}

output "model_armor_template_id" {
  value = google_model_armor_template.tm_prompt_response.template_id
}

output "consumer_topics" {
  value = local.consumer_topics
}

output "topic_publishers" {
  value = local.topic_publishers
}

output "invoker_graph" {
  # Documented for runtime module — authoritative edges
  value = {
    "public-bff"           = ["intent-provenance", "outcome-resolution"]
    "agent-runtime"        = ["intent-provenance", "observability-api"]
    "intent-provenance"    = ["agent-runtime", "observability-api"]
    "authority"            = ["gateway", "observability-api"]
    "gateway"              = ["outcome-resolution", "observability-api"]
    "outcome-resolution"   = ["observability-api"]
    "web"                  = ["public-bff"]
  }
}

output "forbidden_invokers_to_gateway" {
  value = [
    "public-bff",
    "web",
    "observability-api",
    "benchmark-runner",
    "agent-runtime",
    "intent-provenance",
    "outcome-resolution",
  ]
}

output "vpc_network" {
  description = "Self-link of the dedicated TrueMandate S2S VPC"
  value       = google_compute_network.s2s.id
}

output "vpc_subnet" {
  description = "Self-link of the us-central1 Direct VPC subnet"
  value       = google_compute_subnetwork.s2s.id
}

output "vpc_egress" {
  description = "Cloud Run Direct VPC egress setting required to reach Internal Cloud Run"
  value       = "ALL_TRAFFIC"
}

output "model_armor_psc_ip" {
  description = "Reserved internal IP for the regional Model Armor PSC endpoint"
  value       = google_compute_address.modelarmor_psc.address
}

output "model_armor_psc_endpoint" {
  description = "Regional connectivity endpoint name for Model Armor"
  value       = google_network_connectivity_regional_endpoint.modelarmor.name
}

output "model_armor_psc_forwarding_rule" {
  description = "PSC forwarding rule created by the regional endpoint"
  value       = google_network_connectivity_regional_endpoint.modelarmor.psc_forwarding_rule
}

output "model_armor_psc_dns_zone" {
  description = "Private DNS zone that maps the Model Armor REP hostname to the PSC IP"
  value       = google_dns_managed_zone.modelarmor_rep.name
}

output "model_armor_psc_dns_name" {
  value = google_dns_managed_zone.modelarmor_rep.dns_name
}
