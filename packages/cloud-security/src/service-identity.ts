import { ErrorCode, err, ok, type Result } from "@truemandate/protocol";

/** Cloud Run / IAM caller identity classification. */
export const ServiceIdentityKind = {
  HUMAN: "HUMAN",
  CLOUD_SA: "CLOUD_SA",
  AGENT: "AGENT",
  DELEGATED_CAPABILITY: "DELEGATED_CAPABILITY",
} as const;

export type ServiceIdentityKind =
  (typeof ServiceIdentityKind)[keyof typeof ServiceIdentityKind];

export interface VerifiedServiceIdentity {
  readonly kind: ServiceIdentityKind;
  readonly subject: string;
  readonly audience?: string;
}

export interface ServiceIdentityVerifier {
  verify(bearerToken: string): Promise<Result<VerifiedServiceIdentity>>;
}

/**
 * Stub verifier for Cloud Run service-to-service and delegated capability tokens.
 * Production wiring validates OIDC / IAM against expected audiences.
 */
export class StubServiceIdentityVerifier implements ServiceIdentityVerifier {
  private readonly subjects = new Map<string, ServiceIdentityKind>();

  register(subject: string, kind: ServiceIdentityKind): void {
    this.subjects.set(subject, kind);
  }

  async verify(bearerToken: string): Promise<Result<VerifiedServiceIdentity>> {
    if (!bearerToken || bearerToken === "invalid") {
      return err(ErrorCode.VALIDATION_FAILED, "Invalid service identity token");
    }

    const kind = this.subjects.get(bearerToken);
    if (!kind) {
      return err(ErrorCode.VALIDATION_FAILED, "Unknown service identity");
    }

    return ok({ kind, subject: bearerToken });
  }
}
