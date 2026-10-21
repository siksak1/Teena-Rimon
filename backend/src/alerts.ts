import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";

/** Where alert e-mails go: an SNS topic with the developer's e-mail subscribed, or the console (dev). */
export interface AlertSink {
  send(subject: string, message: string): Promise<void>;
}

export class SnsSink implements AlertSink {
  constructor(
    private readonly topicArn: string,
    private readonly sns = new SNSClient({}),
  ) {}

  async send(subject: string, message: string) {
    await this.sns.send(new PublishCommand({ TopicArn: this.topicArn, Subject: subject.slice(0, 99), Message: message }));
  }
}

export class ConsoleSink implements AlertSink {
  readonly sent: { subject: string; message: string }[] = [];
  async send(subject: string, message: string) {
    this.sent.push({ subject, message });
    console.info(`[alert] ${subject}\n${message}`);
  }
}

export type AlertConfig = {
  /** Monthly AI-call counts (all customers) that send one e-mail each, e.g. [25, 50, 100]. */
  thresholds: number[];
  /** Also e-mail each time a supplier format is learned for the first time. */
  newFormats: boolean;
};

/** "25,50,100" → [25, 50, 100]; ignores anything that isn't a positive whole number. */
export function parseThresholds(value: string | undefined): number[] {
  return (value ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
}

/**
 * After an AI call: e-mail when this month's count (all customers) has just
 * reached a threshold. The count is the value the counter's atomic update
 * returned, so each threshold is crossed by exactly one call and sends
 * exactly one e-mail, however many calls run at once.
 */
export async function afterAiCall(
  sink: AlertSink,
  config: AlertConfig,
  call: { slug: string; allMonth: number; customerMonth: number; allMonthCost: number; month: string },
): Promise<boolean> {
  if (!config.thresholds.includes(call.allMonth)) return false;
  await sink.send(
    `LedgerMatch: ${call.allMonth} AI extractions in ${call.month}`,
    [
      `AI extractions this month (${call.month}) reached ${call.allMonth}.`,
      `Latest call: ${call.slug} (${call.customerMonth} this month).`,
      `Estimated AI cost this month: $${call.allMonthCost.toFixed(2)}.`,
      "",
      "Details: scripts/formats.sh usage",
      `Thresholds: ${config.thresholds.join(", ")} (CDK context aiAlertThresholds).`,
    ].join("\n"),
  );
  return true;
}

/** E-mail that a supplier format was learned for the first time. Names and numbers only — no invoice content. */
export async function newFormatLearned(
  sink: AlertSink,
  config: AlertConfig,
  learned: { slug: string; supplierName: string; vatId: string; verified: boolean },
): Promise<boolean> {
  if (!config.newFormats) return false;
  await sink.send(
    `LedgerMatch: new supplier format — ${learned.supplierName}`,
    [
      `A new supplier format was learned: ${learned.supplierName} (VAT ${learned.vatId}), first uploaded by ${learned.slug}.`,
      "Its next invoices will be read in the browser with the learned layout, without the AI.",
      "",
      `Inspect: scripts/formats.sh show ${learned.vatId}`,
    ].join("\n"),
  );
  return true;
}
