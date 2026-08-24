output "cloud_run_services" {
  value = merge(
    {
      for k, svc in local.run_services : k => {
        name    = svc.name
        uri     = svc.uri
        ingress = svc.ingress
      }
    },
    {
      web = {
        name    = google_cloud_run_v2_service.web.name
        uri     = google_cloud_run_v2_service.web.uri
        ingress = google_cloud_run_v2_service.web.ingress
      }
    },
  )
}

output "invoker_edges" {
  value = keys(local.invoker_edges)
}

output "public_invokers" {
  value = {
    web        = "allUsers"
    public-bff = "none (identity token required; web SA only)"
    gateway    = "none (INTERNAL_ONLY; authority SA only)"
  }
}

output "push_subscription_names" {
  value = {
    for k, s in google_pubsub_subscription.push : k => s.name
  }
}

output "push_identities" {
  value = {
    for k, s in google_pubsub_subscription.push : k => {
      subscription = s.name
      consumer_sa  = var.service_account_emails[split("--", k)[0]]
      target       = "${var.name_prefix}-${split("--", k)[0]}"
      endpoint     = "${local.run_services[split("--", k)[0]].uri}/internal/events"
      audience     = local.run_services[split("--", k)[0]].uri
    }
  }
}
