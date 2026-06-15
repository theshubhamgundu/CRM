'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime, timeAgo, cn } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { toast } from 'sonner'

type Tab = 'information' | 'process' | 'notes'

interface User {
  id: string
  full_name: string
}

interface EnquiryNote {
  id: string
  message: string
  created_at: string
  user?: {
    full_name: string
    avatar_url?: string
  }
}

interface Props {
  enquiry: Record<string, any>
  initialNotes: EnquiryNote[]
  users: User[]
}

const STAGES = ['new', 'contacted', 'quoted', 'won', 'lost']

const stageBadge = (s: string) => {
  const map: Record<string, 'blue' | 'orange' | 'gray' | 'green' | 'red'> = {
    new: 'blue', contacted: 'orange', quoted: 'gray', won: 'green', lost: 'red',
  }
  return <Badge label={s.toUpperCase()} variant={map[s] ?? 'gray'} />
}

export default function EnquiryDetailClient({ enquiry, initialNotes, users }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [activeTab, setActiveTab] = useState<Tab>('information')
  const [stage, setStage] = useState(enquiry.pipeline_stage)
  const [assignedTo, setAssignedTo] = useState(enquiry.assigned_to || '')
  const [followUpAt, setFollowUpAt] = useState(enquiry.follow_up_at ? enquiry.follow_up_at.split('T')[0] : '')
  const [newNote, setNewNote] = useState('')
  const [notes, setNotes] = useState<EnquiryNote[]>(initialNotes)
  const [saving, setSaving] = useState(false)

  const [customerName, setCustomerName] = useState(enquiry.customer_name || '')
  const [email, setEmail] = useState(enquiry.email || '')
  const [phone, setPhone] = useState(enquiry.phone || '')

  const business = enquiry.business as { name: string; domain?: string } | null

  async function updateStage(newStage: string) {
    setSaving(true)
    await supabase.from('enquiries').update({ pipeline_stage: newStage }).eq('id', enquiry.id)
    setStage(newStage)
    await addTimelineNote(`Pipeline stage changed to ${newStage.toUpperCase()}`)
    setSaving(false)
    toast.success(`Enquiry marked as ${newStage}`)
    router.refresh()
  }

  async function addTimelineNote(message: string) {
    const { data: userData } = await supabase.auth.getUser()
    const { data: note } = await supabase
      .from('enquiry_notes')
      .insert({ enquiry_id: enquiry.id, user_id: userData.user?.id, message })
      .select('*, user:users(id, full_name, avatar_url)')
      .single()
    if (note) setNotes(prev => [note as EnquiryNote, ...prev])
  }

  async function submitNote() {
    if (!newNote.trim()) return
    await addTimelineNote(newNote)
    setNewNote('')
    toast.success('Note added')
  }

  async function saveProcessSettings() {
    setSaving(true)
    const updates: Record<string, any> = {
      customer_name: customerName || null,
      email: email || null,
      phone: phone || '',
      assigned_to: assignedTo || null,
      follow_up_at: followUpAt ? new Date(followUpAt).toISOString() : null,
    }
    const { error } = await supabase.from('enquiries').update(updates).eq('id', enquiry.id)
    setSaving(false)
    if (error) {
      toast.error('Failed to save settings')
    } else {
      toast.success('Enquiry updated successfully')
      router.refresh()
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'information', label: 'Information' },
    { id: 'process', label: 'Process / Action' },
    { id: 'notes', label: 'Notes', count: notes.length },
  ]

  const infoFields = [
    { label: 'Customer Name', value: enquiry.customer_name || '—' },
    { label: 'Email Address', value: enquiry.email || '—' },
    { label: 'Phone Number', value: enquiry.phone || '—' },
    { label: 'Source', value: enquiry.source || '—' },
    { label: 'Business Context', value: business?.name || '—' },
    { label: 'Created At', value: formatDateTime(enquiry.created_at) },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Heading */}
      <div className="border-b px-5 py-3 bg-surface-gray-1">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-bold text-ink-gray-9">
            ENQUIRY: {enquiry.customer_name || enquiry.email || 'Details'}
          </h1>
          <span className="text-sm text-ink-gray-4">{formatDateTime(enquiry.created_at)}</span>
          <div className="ml-2">{stage ? stageBadge(stage) : null}</div>
        </div>
        <div className="text-sm text-ink-gray-5 mt-0.5">
          Source: {enquiry.source || 'Website Form'} {business ? `· Business: ${business.name}` : ''}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b px-5">
        <div className="flex gap-7 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-ink-gray-9 text-ink-gray-9'
                  : 'border-transparent text-ink-gray-5 hover:text-ink-gray-7'
              )}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="rounded-full bg-surface-gray-2 px-1.5 py-0.5 text-xs text-ink-gray-5">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* INFORMATION TAB */}
        {activeTab === 'information' && (
          <div className="max-w-2xl space-y-6">
            <div className="panel">
              <div className="section-heading">Contact Information</div>
              <table className="w-full text-sm">
                <tbody>
                  {infoFields.map((f, i) => (
                    <tr key={f.label} className={cn(i % 2 === 0 ? 'bg-white' : 'bg-row-stripe/30')}>
                      <td className="py-2.5 px-3 font-medium text-ink-gray-5 w-48">{f.label}</td>
                      <td className="py-2.5 px-3 text-ink-gray-9">{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Custom Notes/Message Payload */}
            {(enquiry.message || enquiry.notes) && (
              <div className="panel space-y-4">
                {enquiry.message && (
                  <div>
                    <div className="section-heading">Message</div>
                    <p className="text-sm text-ink-gray-7 leading-relaxed whitespace-pre-wrap bg-surface-gray-1 p-3 rounded-lg border">
                      {enquiry.message}
                    </p>
                  </div>
                )}
                {enquiry.notes && (
                  <div>
                    <div className="section-heading">Booking Payload Details</div>
                    <p className="text-sm text-ink-gray-7 leading-relaxed whitespace-pre-wrap bg-surface-gray-1 p-3 rounded-lg border">
                      {enquiry.notes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* PROCESS TAB */}
        {activeTab === 'process' && (
          <div className="max-w-2xl space-y-6">
            {/* Status updates */}
            <div className="panel">
              <div className="section-heading font-semibold text-ink-gray-8 mb-3">Update Pipeline Stage</div>
              <div className="flex flex-wrap gap-2">
                {STAGES.map(s => (
                  <button
                    key={s}
                    disabled={saving || stage === s}
                    onClick={() => updateStage(s)}
                    className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                      stage === s
                        ? 'bg-navy text-white border-navy'
                        : 'bg-white text-ink-gray-7 border-outline-gray-3 hover:border-navy hover:text-navy'
                    }`}
                  >
                    {s.replace(/\b\w/g, c => c.toUpperCase())}
                  </button>
                ))}
              </div>
            </div>

            {/* Enquiry Details & Assignment */}
            <div className="panel space-y-4">
              <div className="section-heading">Edit Enquiry Details</div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Customer Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      className="form-input"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="form-label">Phone Number</label>
                    <input
                      type="text"
                      className="form-input"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="form-label">Assign Agent</label>
                    <select
                      className="form-input"
                      value={assignedTo}
                      onChange={e => setAssignedTo(e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Follow Up Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={followUpAt}
                      onChange={e => setFollowUpAt(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button onClick={saveProcessSettings} disabled={saving} className="btn-primary gap-1">
                  <Save className="h-4 w-4" />
                  Save Details
                </button>
              </div>
            </div>
          </div>
        )}

        {/* NOTES TAB */}
        {activeTab === 'notes' && (
          <div className="max-w-2xl space-y-4">
            <div className="panel">
              <textarea
                className="form-input w-full resize-none"
                rows={3}
                placeholder="Add comments or notes..."
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
              />
              <div className="mt-2 flex justify-end">
                <button onClick={submitNote} className="btn-primary">Add Note</button>
              </div>
            </div>

            {/* Notes timeline list */}
            <div className="space-y-0">
              {notes.map((note, i) => (
                <div key={note.id} className="activity-item">
                  <div className="flex flex-col items-center">
                    <div className="mt-1 h-8 w-8 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-medium bg-surface-gray-2 text-ink-gray-5">
                      <Avatar label={note.user?.full_name ?? '?'} size="sm" image={note.user?.avatar_url} />
                    </div>
                    {i < notes.length - 1 && <div className="mt-1 w-px flex-1 bg-outline-gray-2" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-ink-gray-9">{note.user?.full_name ?? 'System'}</span>
                      <span className="ml-auto text-xs text-ink-gray-4">{timeAgo(note.created_at)}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-gray-7 whitespace-pre-wrap">{note.message}</p>
                  </div>
                </div>
              ))}
              {notes.length === 0 && (
                <p className="text-sm text-ink-gray-4 py-4 text-center">No notes yet</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-5 border-t bg-white">
        <button onClick={() => router.push('/admin/enquiries')} className="btn-ghost">
          ← Back to Enquiries
        </button>
      </div>
    </div>
  )
}
