export interface DeliveryResult {
  status: number;
  ok: boolean;
}

/**
 * Abstraction over the actual HTTP delivery, exactly like `EmailAdapter`/
 * `CrmAdapter` — swappable so automated tests never make a real network
 * call to an arbitrary subscriber-controlled URL.
 */
export interface HttpDeliverer {
  post(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<DeliveryResult>;
}

export class FetchHttpDeliverer implements HttpDeliverer {
  async post(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<DeliveryResult> {
    const response = await fetch(url, { method: "POST", headers, body });
    return { status: response.status, ok: response.ok };
  }
}

export class TestHttpDeliverer implements HttpDeliverer {
  readonly requests: Array<{
    url: string;
    headers: Record<string, string>;
    body: string;
  }> = [];
  nextResult: DeliveryResult = { status: 200, ok: true };

  async post(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<DeliveryResult> {
    this.requests.push({ url, headers, body });
    await Promise.resolve();
    return this.nextResult;
  }
}
