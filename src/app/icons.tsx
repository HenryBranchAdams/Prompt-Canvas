import type { SVGProps } from 'react'

function IconBase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  )
}

export function AppMarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 3v18M16 3v18M3 12h18" />
    </IconBase>
  )
}

export function AgentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="8" />
    </IconBase>
  )
}

export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="m8 5 11 7-11 7V5Z" /></IconBase>
}

export function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8" cy="9" r="1.5" />
      <path d="m5 17 4-4 3 3 2-2 5 5" />
    </IconBase>
  )
}

export function VariationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </IconBase>
  )
}

export function EditIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4" /></IconBase>
}

export function UpscaleIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="M9 3H3v6M15 3h6v6M9 21H3v-6M21 15v6h-6M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6" /></IconBase>
}

export function LibraryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
    </IconBase>
  )
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  )
}

export function DuplicateIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </IconBase>
  )
}

export function SaveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M5 4h12l2 2v14H5V4Z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </IconBase>
  )
}

export function LayersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </IconBase>
  )
}

export function ActivityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </IconBase>
  )
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </IconBase>
  )
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.5 16.5 4 4" />
    </IconBase>
  )
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </IconBase>
  )
}
