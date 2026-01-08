"use client"

import * as React from "react"
import { CalendarIcon, X } from "lucide-react"
import { format, isBefore, startOfDay, addDays, addYears } from "date-fns"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DatePickerProps {
  date: Date | undefined
  onDateChange: (date: Date | undefined) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  minDate?: Date
  maxDate?: Date
  clearable?: boolean
}

export function DatePicker({
  date,
  onDateChange,
  placeholder = "Select date",
  disabled = false,
  className,
  minDate,
  maxDate,
  clearable = true,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)

  // Default min date is tomorrow
  const effectiveMinDate = minDate ?? addDays(new Date(), 1)
  // Default max date is 1 year from now
  const effectiveMaxDate = maxDate ?? addYears(new Date(), 1)

  const handleSelect = (selectedDate: Date | undefined) => {
    onDateChange(selectedDate)
    if (selectedDate) {
      setOpen(false)
    }
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onDateChange(undefined)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : placeholder}
          {date && clearable && (
            <X
              className="ml-auto h-4 w-4 opacity-50 hover:opacity-100"
              onClick={handleClear}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleSelect}
          disabled={(date) =>
            isBefore(startOfDay(date), startOfDay(effectiveMinDate)) ||
            isBefore(startOfDay(effectiveMaxDate), startOfDay(date))
          }
          defaultMonth={date ?? effectiveMinDate}
        />
      </PopoverContent>
    </Popover>
  )
}
