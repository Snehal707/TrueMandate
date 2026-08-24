terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    time = {
      source  = "hashicorp/time"
      version = ">= 0.13"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "firestore_database_id" {
  type    = string
  default = "(default)"
}

variable "artifact_registry_repo_id" {
  type    = string
  default = "truemandate"
}

variable "enable_pull_subscriptions" {
  type    = bool
  default = false
}

module "foundation" {
  source = "../../modules/foundation"

  project_id                  = var.project_id
  region                      = var.region
  environment                 = var.environment
  firestore_database_id       = var.firestore_database_id
  artifact_registry_repo_id   = var.artifact_registry_repo_id
  enable_pull_subscriptions   = var.enable_pull_subscriptions
}

# Wave 2: Cloud Monitoring (log-based metrics, dashboard, alerts).
# Non-authoritative — never gates privilege or authorization.
module "monitoring" {
  source = "../../modules/monitoring"

  project_id  = var.project_id
  environment = var.environment
  name_prefix = module.foundation.name_prefix

  depends_on = [module.foundation]
}

# Wave 3.3: BigQuery analytics/history only.
# Never participates in Authority, PreparedAction, CommitToken, Gateway commit,
# current approval, or current IntentState.
module "analytics" {
  source = "../../modules/analytics"

  project_id                = var.project_id
  environment               = var.environment
  name_prefix               = module.foundation.name_prefix
  analytics_export_sa_email = module.foundation.service_account_emails["analytics-export"]
  analytics_query_sa_email  = module.foundation.service_account_emails["analytics-query"]

  depends_on = [module.foundation]
}

output "project_id" {
  value = module.foundation.project_id
}

output "service_account_emails" {
  value = module.foundation.service_account_emails
}

output "pubsub_subscription_names" {
  value = module.foundation.pubsub_subscription_names
}

output "model_armor_template_name" {
  value = module.foundation.model_armor_template_name
}

output "firestore_database" {
  value = module.foundation.firestore_database
}

output "invoker_graph" {
  value = module.foundation.invoker_graph
}

output "monitoring_log_metric_names" {
  value = module.monitoring.log_metric_names
}

output "monitoring_dashboard_id" {
  value = module.monitoring.dashboard_id
}

output "monitoring_alert_policy_ids" {
  value = module.monitoring.alert_policy_ids
}

output "analytics_dataset_id" {
  value = module.analytics.dataset_id
}

output "analytics_table_ids" {
  value = module.analytics.table_ids
}

output "forbidden_invokers_to_gateway" {
  value = module.foundation.forbidden_invokers_to_gateway
}

output "vpc_network" {
  value = module.foundation.vpc_network
}

output "vpc_subnet" {
  value = module.foundation.vpc_subnet
}

output "vpc_egress" {
  value = module.foundation.vpc_egress
}

output "model_armor_psc_ip" {
  value = module.foundation.model_armor_psc_ip
}

output "model_armor_psc_endpoint" {
  value = module.foundation.model_armor_psc_endpoint
}

output "model_armor_psc_forwarding_rule" {
  value = module.foundation.model_armor_psc_forwarding_rule
}

output "model_armor_psc_dns_zone" {
  value = module.foundation.model_armor_psc_dns_zone
}

output "model_armor_psc_dns_name" {
  value = module.foundation.model_armor_psc_dns_name
}

output "name_prefix" {
  value = module.foundation.name_prefix
}

output "region" {
  value = module.foundation.region
}

output "artifact_registry_repo_id" {
  value = module.foundation.artifact_registry_repo_id
}

output "consumer_topics" {
  value = module.foundation.consumer_topics
}

output "topic_publishers" {
  value = module.foundation.topic_publishers
}
