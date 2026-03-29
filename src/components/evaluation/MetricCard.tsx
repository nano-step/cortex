import React from 'react'

interface MetricCardProps {
  label: string
  value: string | number
  format?: 'percent' | 'score' | 'number' | 'correlation'
  trend?: number
  subtitle?: string
  color?: 'green' | 'yellow' | 'red' | 'blue' | 'default'
  size?: 'sm' | 'md' | 'lg'
}

function formatValue(value: string | number, format?: string): string {
  if (typeof value === 'string') return value
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`
  if (format === 'score') return `${value.toFixed(2)} / 5`
  if (format === 'correlation') return `${value > 0 ? '+' : ''}${value.toFixed(2)}`
  return value.toString()
}

const colorMap: Record<string, string> = {
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  red: 'text-red-400',
  blue: 'text-blue-400',
  default: 'text-gray-100'
}

const sizeMap: Record<string, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl'
}

export function MetricCard({ label, value, format, trend, subtitle, color = 'default', size = 'md' }: MetricCardProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-bold tabular-nums ${sizeMap[size] ?? sizeMap.md} ${colorMap[color] ?? colorMap.default}`}>
          {formatValue(value, format)}
        </span>
        {trend !== undefined && trend !== 0 && (
          <span className={`text-xs font-medium ${trend > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend > 0 ? '↑' : '↓'}{Math.abs(trend * 100).toFixed(1)}%
          </span>
        )}
      </div>
      {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
    </div>
  )
}
