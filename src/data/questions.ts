import { EducationLevel, FullQuestion, QuestionTier } from '../types/game';
import { SD_QUESTIONS } from './questions_sd';
import { SMP_QUESTIONS } from './questions_smp';
import { SMA_QUESTIONS } from './questions_sma';

export { SD_QUESTIONS, SMP_QUESTIONS, SMA_QUESTIONS };

export const ALL_QUESTIONS: FullQuestion[] = [
  ...SD_QUESTIONS,
  ...SMP_QUESTIONS,
  ...SMA_QUESTIONS,
];

export const QUESTION_BANK_BY_LEVEL: Record<EducationLevel, FullQuestion[]> = {
  SD: SD_QUESTIONS,
  SMP: SMP_QUESTIONS,
  SMA: SMA_QUESTIONS,
};

export function getQuestionsByLevel(level: EducationLevel): FullQuestion[] {
  return QUESTION_BANK_BY_LEVEL[level] ?? SMA_QUESTIONS;
}

export function getQuestionsByLevelAndTier(
  level: EducationLevel,
  tier: QuestionTier
): FullQuestion[] {
  const pool = getQuestionsByLevel(level).filter((q) => q.question_tier === tier);
  return pool.length > 0 ? pool : getQuestionsByLevel(level);
}
