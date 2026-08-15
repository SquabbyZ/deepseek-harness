// Shadcn-style Calendar: date grid on react-day-picker v10. The v10 classNames
// contract uses `day` (cell) + `day_button` (inner button) with flag classes
// (`selected`, `today`, `outside`, …) applied to the cell; nav chevrons are
// wired through the `Chevron` custom component to the ui-primitives glyphs.
import * as React from 'react'
import { DayPicker } from 'react-day-picker'
import { IconChevronLeftOutline14, IconChevronRightOutline14 } from '../../icons/index.tsx'
import { cn } from './cn.ts'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

const NAV_BUTTON =
  'inline-flex size-7 items-center justify-center rounded-md border border-input bg-transparent p-0 opacity-50 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function Calendar({ className, classNames, components, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0',
        month: 'space-y-4',
        month_caption: 'flex justify-center pt-1 relative items-center',
        caption_label: 'text-sm font-medium',
        nav: 'space-x-1 flex items-center',
        button_previous: cn(NAV_BUTTON, 'absolute left-1'),
        button_next: cn(NAV_BUTTON, 'absolute right-1'),
        chevron: 'size-4',
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]',
        week: 'flex w-full mt-2',
        day: 'relative p-0 text-center text-sm focus-within:relative focus-within:z-20',
        day_button: cn(
          'flex h-8 w-8 items-center justify-center rounded-md p-0 font-normal transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
        ),
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground [&>button]:focus:bg-primary [&>button]:focus:text-primary-foreground',
        today: '[&>button]:bg-accent [&>button]:text-accent-foreground',
        outside: '[&>button]:text-muted-foreground',
        disabled: '[&>button]:text-muted-foreground [&>button]:opacity-50',
        range_start:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-l-md',
        range_end:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:rounded-r-md',
        range_middle: '[&>button]:bg-accent [&>button]:text-accent-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ className: chevronClassName, orientation }) =>
          orientation === 'left' ? (
            <IconChevronLeftOutline14 className={chevronClassName} />
          ) : (
            <IconChevronRightOutline14 className={chevronClassName} />
          ),
        ...components,
      }}
      {...props}
    />
  )
}
Calendar.displayName = 'Calendar'

export { Calendar }
