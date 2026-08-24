terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
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

variable "image_tag" {
  type    = string
  default = "dev"
}

variable "enable_public_bff_ingress" {
  type    = bool
  default = true
}

variable "use_foundation_fixture" {
  type        = bool
  default     = true
  description = "When true (pre-apply), use foundation-outputs.fixture.json instead of remote state"
}

variable "foundation_state_path" {
  type    = string
  default = "../foundation/terraform.tfstate"
}

variable "enable_secret_preflight" {
  type    = bool
  default = true
}

variable "required_secret_ids" {
  type    = list(string)
  default = []
}

variable "agent_runtime_revision_nonce" {
  type    = string
  default = ""
}

variable "image_digests" {
  type        = map(string)
  description = "Image name → sha256 digest for digest-pinned Cloud Run services"
}

variable "benchmark_v2_image_digest" {
  type        = string
  description = "Dedicated sha256 digest for the isolated BENCHMARK_V2 Cloud Run Job. Does not roll the health-only benchmark-runner service."

  validation {
    condition     = can(regex("^(sha256:)?[0-9a-f]{64}$", var.benchmark_v2_image_digest))
    error_message = "benchmark_v2_image_digest must be a sha256 digest."
  }
}

variable "service_urls" {
  type        = map(string)
  description = "Canonical Cloud Run service URLs used by runtime S2S configuration."
}

variable "vpc_network" {
  type        = string
  default     = ""
  description = "Override Foundation VPC self-link when remote state does not yet export it (plan-only overlay)."
}

variable "vpc_subnet" {
  type        = string
  default     = ""
  description = "Override Foundation subnet self-link when remote state does not yet export it."
}

variable "vpc_egress" {
  type    = string
  default = "ALL_TRAFFIC"
}

locals {
  fixture = jsondecode(file("${path.module}/foundation-outputs.fixture.json"))

  foundation = var.use_foundation_fixture ? {
    service_account_emails    = local.fixture.service_account_emails
    model_armor_template_name = local.fixture.model_armor_template_name
    consumer_topics           = local.fixture.consumer_topics
    name_prefix               = local.fixture.name_prefix
    artifact_registry_repo_id = local.fixture.artifact_registry_repo_id
    region                    = local.fixture.region
    vpc_network               = local.fixture.vpc_network
    vpc_subnet                = local.fixture.vpc_subnet
    vpc_egress                = local.fixture.vpc_egress
    } : {
    service_account_emails    = data.terraform_remote_state.foundation[0].outputs.service_account_emails
    model_armor_template_name = data.terraform_remote_state.foundation[0].outputs.model_armor_template_name
    consumer_topics           = data.terraform_remote_state.foundation[0].outputs.consumer_topics
    name_prefix               = data.terraform_remote_state.foundation[0].outputs.name_prefix
    artifact_registry_repo_id = data.terraform_remote_state.foundation[0].outputs.artifact_registry_repo_id
    region                    = data.terraform_remote_state.foundation[0].outputs.region
    vpc_network               = data.terraform_remote_state.foundation[0].outputs.vpc_network
    vpc_subnet                = data.terraform_remote_state.foundation[0].outputs.vpc_subnet
    vpc_egress                = data.terraform_remote_state.foundation[0].outputs.vpc_egress
  }

  # Prefer explicit -var/tfvars overlay, then applied Foundation remote state
  # (or fixture when use_foundation_fixture=true).
  vpc_network = coalesce(
    var.vpc_network != "" ? var.vpc_network : null,
    try(local.foundation.vpc_network, null),
  )
  vpc_subnet = coalesce(
    var.vpc_subnet != "" ? var.vpc_subnet : null,
    try(local.foundation.vpc_subnet, null),
  )
  vpc_egress = coalesce(
    var.vpc_egress != "" ? var.vpc_egress : null,
    try(local.foundation.vpc_egress, null),
    "ALL_TRAFFIC",
  )
}

data "terraform_remote_state" "foundation" {
  count = var.use_foundation_fixture ? 0 : 1

  backend = "local"
  config = {
    path = var.foundation_state_path
  }
}

module "runtime" {
  source = "../../modules/runtime"

  project_id                   = var.project_id
  region                       = local.foundation.region
  environment                  = var.environment
  image_tag                    = var.image_tag
  image_digests                = var.image_digests
  benchmark_v2_image_digest    = var.benchmark_v2_image_digest
  agent_runtime_revision_nonce = var.agent_runtime_revision_nonce
  artifact_registry_repo_id    = local.foundation.artifact_registry_repo_id
  enable_public_bff_ingress    = var.enable_public_bff_ingress
  service_account_emails       = local.foundation.service_account_emails
  service_urls                 = var.service_urls
  model_armor_template_name    = local.foundation.model_armor_template_name
  consumer_topics              = local.foundation.consumer_topics
  name_prefix                  = local.foundation.name_prefix
  enable_secret_preflight      = var.enable_secret_preflight
  required_secret_ids          = var.required_secret_ids
  vpc_network                  = local.vpc_network
  vpc_subnet                   = local.vpc_subnet
  vpc_egress                   = local.vpc_egress
}

output "cloud_run_services" {
  value = module.runtime.cloud_run_services
}

output "invoker_edges" {
  value = module.runtime.invoker_edges
}

output "public_invokers" {
  value = module.runtime.public_invokers
}

output "push_subscription_names" {
  value = module.runtime.push_subscription_names
}

output "push_identities" {
  value = module.runtime.push_identities
}
