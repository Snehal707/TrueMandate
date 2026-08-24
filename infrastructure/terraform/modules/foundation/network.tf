# Dedicated TrueMandate S2S VPC for Direct VPC egress to Internal Cloud Run.
# Callers of INTERNAL_ONLY destinations send *.run.app traffic through this
# network with egress=ALL_TRAFFIC and Private Google Access. Destinations are
# Google APIs / Internal Cloud Run only — no Cloud NAT.

resource "google_compute_network" "s2s" {
  name                    = "${local.name_prefix}-s2s"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  project                 = var.project_id

  depends_on = [
    google_project_service.required_apis["compute.googleapis.com"],
    time_sleep.wait_apis,
  ]
}

resource "google_compute_subnetwork" "s2s" {
  name                     = "${local.name_prefix}-s2s-usc1"
  ip_cidr_range            = "10.64.0.0/24"
  region                   = var.region
  network                  = google_compute_network.s2s.id
  private_ip_google_access = true
  project                  = var.project_id

  # Diagnostic visibility into private-path (PSC) connection attempts.
  # Aggregation/sampling follow GCP defaults for sampled VPC Flow Logs.
  log_config {
    aggregation_interval = "INTERVAL_5_SEC"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }
}

# Regional PSC for Model Armor REP. PGA does not cover *.rep.googleapis.com.
# Reserved IP is outside the observed Serverless allocation beginning at 10.64.0.16.
# Bind the regional endpoint to the existing Address resource URL. An IP literal
# makes the API allocate rep-autogen-addr-* at the same IP and fail with
# "the IP address is already being used by another resource".

resource "google_compute_address" "modelarmor_psc" {
  name         = "${local.name_prefix}-modelarmor-psc"
  project      = var.project_id
  region       = var.region
  address_type = "INTERNAL"
  purpose      = "GCE_ENDPOINT"
  subnetwork   = google_compute_subnetwork.s2s.id
  address      = "10.64.0.5"

  depends_on = [
    google_project_service.required_apis["compute.googleapis.com"],
    google_compute_subnetwork.s2s,
  ]
}

resource "google_network_connectivity_regional_endpoint" "modelarmor" {
  name              = "${local.name_prefix}-modelarmor-rep"
  project           = var.project_id
  location          = var.region
  target_google_api = "modelarmor.us-central1.rep.googleapis.com"
  access_type       = "REGIONAL"
  network           = google_compute_network.s2s.id
  subnetwork        = google_compute_subnetwork.s2s.id
  # Create-time binding uses the Address resource URI. The Google provider
  # (6.50) refreshes address as the IP literal and clears subnetwork; both
  # ForceNew. Ignore those two provider-normalized representations only.
  address = google_compute_address.modelarmor_psc.id

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [address, subnetwork]
  }

  depends_on = [
    google_project_service.required_apis["networkconnectivity.googleapis.com"],
    google_compute_address.modelarmor_psc,
  ]
}

resource "google_dns_managed_zone" "modelarmor_rep" {
  name        = "${local.name_prefix}-modelarmor-usc1-rep"
  project     = var.project_id
  dns_name    = "modelarmor.us-central1.rep.googleapis.com."
  description = "Private DNS for regional Model Armor PSC"
  visibility  = "private"

  private_visibility_config {
    networks {
      network_url = google_compute_network.s2s.id
    }
  }

  depends_on = [
    google_project_service.required_apis["dns.googleapis.com"],
    google_compute_network.s2s,
  ]
}

resource "google_dns_record_set" "modelarmor_rep" {
  name         = google_dns_managed_zone.modelarmor_rep.dns_name
  project      = var.project_id
  managed_zone = google_dns_managed_zone.modelarmor_rep.name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_address.modelarmor_psc.address]
}
