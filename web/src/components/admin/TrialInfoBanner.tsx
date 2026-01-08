"use client";

import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Clock, AlertTriangle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseISO, differenceInDays } from "date-fns";

interface TrialInfoBannerProps {
  trialStart: string;
  trialEnd: string;
  adminGranted?: boolean;
  adminReason?: string | null;
  grantedAt?: string | null;
}

export function TrialInfoBanner({
  trialStart,
  trialEnd,
  adminGranted,
  adminReason,
  grantedAt,
}: TrialInfoBannerProps) {
  const now = new Date();
  const endDate = parseISO(trialEnd);
  const startDate = parseISO(trialStart);
  const daysRemaining = differenceInDays(endDate, now);
  const isExpired = daysRemaining < 0;
  const isEndingSoon = daysRemaining >= 0 && daysRemaining <= 3;
  const isWarning = daysRemaining > 3 && daysRemaining <= 7;

  // Determine color scheme based on urgency
  let colorClasses = "border-blue-200 bg-blue-50";
  let textColor = "text-blue-800";
  let iconColor = "text-blue-600";
  let IconComponent = Clock;

  if (isExpired) {
    colorClasses = "border-red-200 bg-red-50";
    textColor = "text-red-800";
    iconColor = "text-red-600";
    IconComponent = XCircle;
  } else if (isEndingSoon) {
    colorClasses = "border-red-200 bg-red-50";
    textColor = "text-red-800";
    iconColor = "text-red-600";
    IconComponent = AlertTriangle;
  } else if (isWarning) {
    colorClasses = "border-amber-200 bg-amber-50";
    textColor = "text-amber-800";
    iconColor = "text-amber-600";
    IconComponent = AlertTriangle;
  }

  return (
    <Alert className={cn(colorClasses, "mb-4")}>
      <IconComponent className={cn("h-4 w-4", iconColor)} />
      <AlertTitle className={textColor}>
        {isExpired ? "Trial Expired" : "Trial Active"}
        {adminGranted && " (Admin Granted)"}
      </AlertTitle>
      <AlertDescription className={cn(textColor, "opacity-90")}>
        <div className="space-y-1 mt-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">Started:</span>
            <span>{new Date(trialStart).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric"
            })}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">
              {isExpired ? "Ended:" : "Ends:"}
            </span>
            <span>{new Date(trialEnd).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit"
            })}</span>
            {!isExpired && (
              <span className="font-semibold">
                ({daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining)
              </span>
            )}
          </div>
          {adminGranted && adminReason && (
            <div className="flex items-start gap-2 text-sm mt-2 pt-2 border-t border-current/20">
              <span className="font-medium">Reason:</span>
              <span className="italic">{adminReason}</span>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
