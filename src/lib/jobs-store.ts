import { tx } from './saved'
import type { Job, Person } from './jobs'

export const listJobs = () =>
  tx('readonly', (s) => s.getAll() as IDBRequest<Job[]>, 'jobs').then((all) => all.sort((a, b) => a.startDate.localeCompare(b.startDate)))
export const getJob = (id: string) => tx('readonly', (s) => s.get(id) as IDBRequest<Job | undefined>, 'jobs')
export const putJob = (j: Job) => tx('readwrite', (s) => s.put({ ...j, updatedAt: new Date().toISOString() }), 'jobs').then(() => j)
export const deleteJob = (id: string) => tx('readwrite', (s) => s.delete(id), 'jobs').then(() => undefined)

export const listPeople = () =>
  tx('readonly', (s) => s.getAll() as IDBRequest<Person[]>, 'people').then((all) => all.sort((a, b) => a.name.localeCompare(b.name)))
export const putPerson = (p: Person) => tx('readwrite', (s) => s.put(p), 'people').then(() => p)
export const deletePerson = (id: string) => tx('readwrite', (s) => s.delete(id), 'people').then(() => undefined)

/** Simple change notification so open screens refresh when jobs/people change. */
const listeners = new Set<() => void>()
export const onJobsChanged = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn))
export const jobsChanged = () => listeners.forEach((l) => l())
