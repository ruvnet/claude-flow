import type { HelpTopic } from './help-docs'
import { CORE_TOPICS } from './help-topics-core'
import { MORE_TOPICS } from './help-topics-more'

/** Every guide, in reading order. */
export const TOPICS: readonly HelpTopic[] = [...CORE_TOPICS, ...MORE_TOPICS]

export const topicById = (id: string | null): HelpTopic | null => (id === null ? null : (TOPICS.find(topic => topic.id === id) ?? null))
