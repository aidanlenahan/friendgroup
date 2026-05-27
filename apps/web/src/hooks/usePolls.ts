import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

export type PollOptionVotes = {
  yes: number
  no: number
  maybe: number
  myAnswer: 'yes' | 'no' | 'maybe' | null
}

export type PollOption = {
  id: string
  order: number
  title: string
  dateTime: string | null
  description: string | null
  location: string | null
  votes: PollOptionVotes
}

export type Poll = {
  id: string
  groupId: string
  question: string
  closedAt: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; name: string; avatarUrl: string | null } | null
  isCreator: boolean
  isAdmin: boolean
  options: PollOption[]
}

type PollsResponse = { polls: Poll[] }
type PollResponse = { poll: Poll }

export function useGroupPolls(groupId: string) {
  return useQuery<PollsResponse>({
    queryKey: ['groups', groupId, 'polls'],
    queryFn: () => apiFetch<PollsResponse>(`/groups/${groupId}/polls`),
    enabled: !!groupId,
  })
}

export function usePoll(pollId: string) {
  return useQuery<PollResponse>({
    queryKey: ['polls', pollId],
    queryFn: () => apiFetch<PollResponse>(`/polls/${pollId}`),
    enabled: !!pollId,
  })
}

export type CreatePollInput = {
  groupId: string
  question: string
  options: Array<{
    title: string
    dateTime?: string
    description?: string
    location?: string
  }>
}

export function useCreatePoll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, ...body }: CreatePollInput) =>
      apiFetch<PollResponse>(`/groups/${groupId}/polls`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['groups', vars.groupId, 'polls'] })
    },
  })
}

export type UpdatePollInput = {
  pollId: string
  groupId: string
  question?: string
  options?: Array<{
    title: string
    dateTime?: string
    description?: string
    location?: string
    order: number
  }>
}

export function useUpdatePoll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pollId, groupId: _g, ...body }: UpdatePollInput) =>
      apiFetch<PollResponse>(`/polls/${pollId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (data, vars) => {
      qc.setQueryData(['polls', vars.pollId], data)
      qc.invalidateQueries({ queryKey: ['groups', vars.groupId, 'polls'] })
    },
  })
}

export function useDeletePoll(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pollId: string) =>
      apiFetch(`/polls/${pollId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'polls'] })
    },
  })
}

export function useVote(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pollId, optionId, answer }: { pollId: string; optionId: string; answer: 'yes' | 'no' | 'maybe' }) =>
      apiFetch(`/polls/${pollId}/options/${optionId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ answer }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['polls', vars.pollId] })
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'polls'] })
    },
  })
}

export function useRemoveVote(groupId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ pollId, optionId }: { pollId: string; optionId: string }) =>
      apiFetch(`/polls/${pollId}/options/${optionId}/vote`, { method: 'DELETE' }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['polls', vars.pollId] })
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'polls'] })
    },
  })
}
