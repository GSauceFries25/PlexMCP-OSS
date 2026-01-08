import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Clock, Zap } from "lucide-react";
import { useAdminUpdateUser } from "@/lib/api/hooks/use-admin";
import { tierChangeFormSchema, type TierChangeFormData } from "./TierChangeModal.types";

interface TierChangeModalProps {
  userId: string;
  selectedTier: string;
  currentTier: string;
  orgId: string;
  hasPaymentMethod: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** ISO date string for current subscription period end (for downgrades) */
  currentPeriodEnd?: string | null;
}

// Helper functions to determine tier order and upgrade/downgrade status
const tierOrder = (tier: string): number => {
  const order: Record<string, number> = {
    free: 0,
    pro: 1,
    team: 2,
    enterprise: 3,
  };
  return order[tier.toLowerCase()] || 0;
};

const isDowngrade = (from: string, to: string): boolean => {
  return tierOrder(to) < tierOrder(from);
};

const isUpgrade = (from: string, to: string): boolean => {
  return tierOrder(to) > tierOrder(from);
};

export function TierChangeModal({
  userId,
  selectedTier,
  currentTier,
  orgId,
  hasPaymentMethod,
  open,
  onOpenChange,
  onSuccess,
  currentPeriodEnd,
}: TierChangeModalProps) {
  const updateUserMutation = useAdminUpdateUser();

  const form = useForm<TierChangeFormData>({
    resolver: zodResolver(tierChangeFormSchema),
    defaultValues: {
      tier: selectedTier as any,
      billingInterval: "monthly",
      paymentMethod: hasPaymentMethod ? "immediate" : "trial",
      reason: "",
      downgradeTiming: "scheduled",
      refundType: "credit",
    },
  });

  const watchedTier = form.watch("tier");
  const watchedInterval = form.watch("billingInterval");
  const watchedPaymentMethod = form.watch("paymentMethod");

  // Reset form when modal opens or selectedTier changes
  useEffect(() => {
    if (open) {
      // For free tier, payment method doesn't matter (no billing) - default to immediate
      const defaultPaymentMethod = selectedTier === "free"
        ? "immediate"
        : (hasPaymentMethod ? "immediate" : "trial");

      form.reset({
        tier: selectedTier as any,
        billingInterval: "monthly",
        paymentMethod: defaultPaymentMethod,
        reason: "",
        downgradeTiming: "scheduled",
        refundType: "credit",
      });
    }
  }, [open, selectedTier, hasPaymentMethod, form]);

  const onSubmit = async (data: TierChangeFormData) => {
    try {
      const isDowngradeAction = isDowngrade(currentTier, selectedTier);
      const isFreeDowngrade = selectedTier === "free" && currentTier !== "free";

      const customPriceCents =
        watchedTier === "enterprise"
          ? (watchedInterval === "monthly" ? data.customPriceMonthly : data.customPriceAnnual)! * 100
          : undefined;

      const subscriptionStartDate = data.subscriptionStartDate && data.subscriptionStartDate.trim() !== ''
        ? data.subscriptionStartDate
        : undefined;

      await updateUserMutation.mutateAsync({
        userId,
        data: {
          subscription_tier: data.tier,
          // Only for upgrades (or same tier changes) - downgrades inherit current interval
          billing_interval: isDowngradeAction ? undefined : data.billingInterval,
          custom_price_cents: isDowngradeAction ? undefined : customPriceCents,
          payment_method: isDowngradeAction ? undefined : data.paymentMethod,
          trial_days: isDowngradeAction ? undefined : (data.paymentMethod === "trial" ? data.trialDays : undefined),
          subscription_start_date: isDowngradeAction ? undefined : subscriptionStartDate,
          // For all downgrades (including to Free tier)
          downgrade_timing: isDowngradeAction ? data.downgradeTiming : undefined,
          // For immediate downgrades: refund type (refund = money back, credit = Stripe credit)
          refund_type: isDowngradeAction && data.downgradeTiming === "immediate"
            ? data.refundType
            : undefined,
          // Always required
          reason: data.reason,
        },
      });

      onSuccess?.();
      onOpenChange(false);
    } catch {
      // Error handled by mutation
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configure Tier Change</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6"
        >
          {/* Tier display (read-only) */}
          <div className="p-4 bg-muted rounded-md space-y-2">
            <p className="text-sm text-muted-foreground">
              Changing from <span className="font-semibold text-foreground">{currentTier}</span> to{" "}
              <span className="font-semibold text-foreground">{selectedTier}</span>
            </p>

            {/* Show whether this will be immediate or scheduled */}
            {isDowngrade(currentTier, selectedTier) && form.watch("downgradeTiming") === "scheduled" && (
              <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                <Clock className="h-4 w-4" />
                <span className="text-sm">
                  This downgrade will take effect at the end of the current billing period
                  {selectedTier === "free" && " (subscription will be cancelled)"}
                </span>
              </div>
            )}
            {isDowngrade(currentTier, selectedTier) && form.watch("downgradeTiming") === "immediate" && (
              <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                <Zap className="h-4 w-4" />
                <span className="text-sm">
                  This downgrade will take effect immediately with prorated{" "}
                  {form.watch("refundType") === "refund" ? "refund (money back)" : "credit"}
                  {selectedTier === "free" && " — subscription will be cancelled"}
                </span>
              </div>
            )}
            {isUpgrade(currentTier, selectedTier) && (
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <Zap className="h-4 w-4" />
                <span className="text-sm">
                  This upgrade will take effect immediately with prorated billing
                </span>
              </div>
            )}
          </div>

          {/* Hidden input for tier - ensures value is registered with form */}
          <input type="hidden" {...form.register("tier")} value={selectedTier} />

          {/* Global form errors */}
          {Object.keys(form.formState.errors).length > 0 && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md">
              <p className="text-sm font-semibold text-destructive mb-2">Please fix the following errors:</p>
              <ul className="text-sm text-destructive space-y-1">
                {Object.entries(form.formState.errors).map(([key, error]) => (
                  <li key={key}>
                    • {key}: {error?.message?.toString() || "Invalid value"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* =========== UPGRADE FORM FIELDS =========== */}
          {/* Only show these for upgrades or same-tier changes (not downgrades) */}

          {/* Billing Interval - Upgrades only */}
          {selectedTier !== "free" && !isDowngrade(currentTier, selectedTier) && (
            <div className="space-y-2">
              <Label>Billing Interval</Label>
              <RadioGroup
                value={watchedInterval}
                onValueChange={(value) => form.setValue("billingInterval", value as any)}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="monthly" id="monthly" />
                  <Label htmlFor="monthly" className="font-normal cursor-pointer">
                    Monthly
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="annual" id="annual" />
                  <Label htmlFor="annual" className="font-normal cursor-pointer">
                    Annual
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Custom Pricing (Enterprise only) */}
          {watchedTier === "enterprise" && (
            <div className="space-y-4 p-4 border rounded-md bg-muted/50">
              <Label className="text-base font-semibold">Custom Pricing</Label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="customPriceMonthly">Monthly Price ($)</Label>
                  <Input
                    id="customPriceMonthly"
                    type="number"
                    placeholder="5000"
                    {...form.register("customPriceMonthly", { valueAsNumber: true })}
                  />
                  {form.formState.errors.customPriceMonthly && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.customPriceMonthly.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customPriceAnnual">Annual Price ($)</Label>
                  <Input
                    id="customPriceAnnual"
                    type="number"
                    placeholder="50000"
                    {...form.register("customPriceAnnual", { valueAsNumber: true })}
                  />
                  {form.formState.errors.customPriceAnnual && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.customPriceAnnual.message}
                    </p>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter the custom price for this Enterprise account. The price will be billed{" "}
                {watchedInterval === "monthly" ? "monthly" : "annually"}.
              </p>
            </div>
          )}

          {/* Payment Method - Upgrades only */}
          {selectedTier !== "free" && !isDowngrade(currentTier, selectedTier) && (
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <RadioGroup
                value={watchedPaymentMethod}
                onValueChange={(value) => form.setValue("paymentMethod", value as any)}
              >
                {hasPaymentMethod && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="immediate" id="immediate" />
                    <Label htmlFor="immediate" className="font-normal cursor-pointer">
                      Charge immediately (payment method on file)
                    </Label>
                  </div>
                )}
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="invoice" id="invoice" />
                  <Label htmlFor="invoice" className="font-normal cursor-pointer">
                    Send invoice (email to customer with 30-day payment terms)
                  </Label>
                </div>
                {!hasPaymentMethod && (
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="trial" id="trial" />
                    <Label htmlFor="trial" className="font-normal cursor-pointer">
                      Grant trial period (no payment required)
                    </Label>
                  </div>
                )}
              </RadioGroup>
            </div>
          )}

          {/* Trial Days - Upgrades only */}
          {selectedTier !== "free" && !isDowngrade(currentTier, selectedTier) && watchedPaymentMethod === "trial" && (
            <div className="space-y-2">
              <Label htmlFor="trialDays">Trial Period (days)</Label>
              <Input
                id="trialDays"
                type="number"
                placeholder="14"
                min="0"
                max="730"
                {...form.register("trialDays", { valueAsNumber: true })}
              />
              {form.formState.errors.trialDays && (
                <p className="text-sm text-destructive">{form.formState.errors.trialDays.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Stripe allows trial periods up to 730 days (2 years). Customer must add payment method before
                trial ends.
              </p>
            </div>
          )}

          {/* Subscription Start Date - Upgrades only */}
          {selectedTier !== "free" && !isDowngrade(currentTier, selectedTier) && (
            <div className="space-y-2">
              <Label htmlFor="subscriptionStartDate">Subscription Start Date (optional)</Label>
              <Input
                id="subscriptionStartDate"
                type="datetime-local"
                {...form.register("subscriptionStartDate")}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to start immediately. If set, subscription will begin on this date.
              </p>
              {form.formState.errors.subscriptionStartDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.subscriptionStartDate.message}
                </p>
              )}
            </div>
          )}

          {/* =========== DOWNGRADE FORM FIELDS =========== */}
          {/* Show for all downgrades including to Free tier */}

          {/* Downgrade Timing */}
          {isDowngrade(currentTier, selectedTier) && (
            <div className="space-y-4">
              <Label>When should this downgrade take effect?</Label>
              <RadioGroup
                value={form.watch("downgradeTiming") || "scheduled"}
                onValueChange={(v) => form.setValue("downgradeTiming", v as "scheduled" | "immediate")}
                className="space-y-3"
              >
                <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="scheduled" id="scheduled" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="scheduled" className="font-medium cursor-pointer">
                      At end of billing period
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      {currentPeriodEnd ? (
                        <>Effective on {new Date(currentPeriodEnd).toLocaleDateString("en-US", {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                          day: "numeric"
                        })} — User keeps full access until then</>
                      ) : (
                        "User keeps full access until current billing period ends"
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-muted/50 cursor-pointer">
                  <RadioGroupItem value="immediate" id="immediate-downgrade" className="mt-1" />
                  <div className="flex-1">
                    <Label htmlFor="immediate-downgrade" className="font-medium cursor-pointer">
                      Immediate
                    </Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Takes effect now with prorated refund/credit for unused time
                    </p>
                  </div>
                </div>
              </RadioGroup>

              {/* Refund Type - only when Immediate is selected */}
              {form.watch("downgradeTiming") === "immediate" && (
                <div className="space-y-3 ml-4 p-4 border-l-2 border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 rounded-r-lg">
                  <Label>How should unused time be handled?</Label>
                  <RadioGroup
                    value={form.watch("refundType") || "credit"}
                    onValueChange={(v) => form.setValue("refundType", v as "refund" | "credit")}
                    className="space-y-2"
                  >
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="credit" id="credit" className="mt-1" />
                      <div className="flex-1">
                        <Label htmlFor="credit" className="font-medium cursor-pointer">
                          Issue prorated credit
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Credit applied to Stripe account for future use
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="refund" id="refund" className="mt-1" />
                      <div className="flex-1">
                        <Label htmlFor="refund" className="font-medium cursor-pointer">
                          Issue prorated refund
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Money back to original payment method
                        </p>
                      </div>
                    </div>
                  </RadioGroup>
                </div>
              )}
            </div>
          )}

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason for change</Label>
            <Textarea
              id="reason"
              placeholder="e.g., Customer upgraded for team features"
              rows={3}
              {...form.register("reason")}
            />
            {form.formState.errors.reason && (
              <p className="text-sm text-destructive">{form.formState.errors.reason.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              This will be recorded in audit logs and Stripe metadata.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateUserMutation.isPending}>
              {updateUserMutation.isPending ? "Applying..." : "Apply Tier Change"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
