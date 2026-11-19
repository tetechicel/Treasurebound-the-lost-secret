import { getQuestionsByLevel, getQuestionsByLevelAndTier } from '../data/questions';
import {
  CollectedFragment,
  EducationLevel,
  MapConfiguration,
  PublicQuestion,
  QuestionTier,
  QuizChallengeKind,
  QuizSubmissionResult,
} from '../types/game';
import { getPlayerSessionToken } from './playerSession';
import { requireSupabase } from './supabase';

// Used only in explicit Solo Practice mode
const soloUsedQuestionIds = new Set<string>();

export function resetSoloQuestionHistory() {
  soloUsedQuestionIds.clear();
}

export function getQuestionTierForChallenge(kind: QuizChallengeKind): QuestionTier {
  if (kind === 'large_treasure') return 'large';
  if (kind === 'small_chest') return 'small';
  return 'bonus';
}

export async function fetchChallengeQuestions(params: {
  matchId: string;
  playerId: string;
  educationLevel: EducationLevel;
  tier: QuestionTier;
  count: number;
  isSoloPractice: boolean;
}): Promise<PublicQuestion[]> {
  if (params.isSoloPractice) {
    const tierPool = getQuestionsByLevelAndTier(params.educationLevel, params.tier);
    const levelPool = getQuestionsByLevel(params.educationLevel);

    let candidates = tierPool.filter((q) => !soloUsedQuestionIds.has(q.id));
    if (candidates.length < params.count) {
      const extra = levelPool.filter(
        (q) => !soloUsedQuestionIds.has(q.id) && !candidates.some((c) => c.id === q.id)
      );
      candidates = [...candidates, ...extra];
    }
    if (candidates.length < params.count) {
      candidates = [...tierPool];
    }

    const picked: PublicQuestion[] = [];
    const poolCopy = [...candidates];
    while (picked.length < params.count && poolCopy.length > 0) {
      const idx = Math.floor(Math.random() * poolCopy.length);
      const q = poolCopy.splice(idx, 1)[0];
      soloUsedQuestionIds.add(q.id);
      picked.push({
        id: q.id,
        education_level: q.education_level,
        question_tier: q.question_tier,
        subject: q.subject,
        topic: q.topic,
        difficulty: q.difficulty,
        question_text: q.question_text,
        options: q.options,
      });
    }
    return picked;
  }

  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(params.playerId);
  const { data, error } = await client.rpc('get_challenge_questions', {
    p_match_id: params.matchId,
    p_player_id: params.playerId,
    p_education_level: params.educationLevel,
    p_tier: params.tier,
    p_count: params.count,
    p_session_token: sessionToken,
  });

  if (error) {
    throw new Error(error.message || 'Gagal memuat pertanyaan dari server');
  }

  return (data ?? []) as PublicQuestion[];
}

export async function submitChallengeAnswer(params: {
  matchId: string;
  playerId: string;
  questionId: string;
  selectedIndex: number;
  itemKey: string;
  challengeKind: QuizChallengeKind;
  seriesCorrectCount: number;
  seriesTotal: number;
  isSoloPractice: boolean;
  educationLevel: EducationLevel;
  currentHealth: number;
  currentScore: number;
  currentCoins: number;
  mapConfig?: MapConfiguration;
}): Promise<QuizSubmissionResult> {
  if (params.isSoloPractice) {
    const levelPool = getQuestionsByLevel(params.educationLevel);
    const q = levelPool.find((item) => item.id === params.questionId);
    if (!q) throw new Error('Pertanyaan tidak ditemukan');

    const isCorrect = params.selectedIndex === q.correct_answer;
    let pointsDelta = 0;
    let bonusPointsDelta = 0;
    let hpDelta = 0;
    let challengeCompleted = false;
    let fragmentAwarded: CollectedFragment | null = null;
    let unlockedGateId: string | null = null;

    if (isCorrect) {
      pointsDelta =
        params.challengeKind === 'small_chest'
          ? 10
          : params.challengeKind === 'large_treasure'
            ? 20
            : 15;

      if (params.challengeKind === 'small_chest') {
        if (params.seriesCorrectCount >= params.seriesTotal) {
          challengeCompleted = true;
          bonusPointsDelta = 25;
          const chest = params.mapConfig?.smallChests.find((c) => c.id === params.itemKey);
          fragmentAwarded = {
            chestId: params.itemKey,
            chestName: chest?.name ?? params.itemKey,
            code: chest?.fragmentCode ?? 'RUNA',
            earnedAt: new Date().toISOString(),
          };
        }
      } else if (params.challengeKind === 'large_treasure') {
        if (params.seriesCorrectCount >= params.seriesTotal) {
          challengeCompleted = true;
        }
      } else {
        challengeCompleted = true;
        if (params.challengeKind === 'locked_gate') {
          unlockedGateId = params.itemKey;
        }
      }
    } else {
      hpDelta = -5;
    }

    const newHp = Math.max(10, Math.min(100, params.currentHealth + hpDelta));
    const totalAdded = pointsDelta + bonusPointsDelta;
    const newScore = params.currentScore + totalAdded;
    const newCoins = params.currentCoins + totalAdded;

    return {
      is_correct: isCorrect,
      correct_index: q.correct_answer,
      explanation: q.explanation,
      points_delta: pointsDelta,
      bonus_points_delta: bonusPointsDelta,
      hp_delta: hpDelta,
      new_hp: newHp,
      new_score: newScore,
      new_coins: newCoins,
      challenge_completed: challengeCompleted,
      fragment_awarded: fragmentAwarded,
      unlocked_gate_id: unlockedGateId,
      series_correct_count: isCorrect ? params.seriesCorrectCount : params.seriesCorrectCount - 1,
      series_total: params.seriesTotal,
      already_answered: false,
    };
  }

  const client = requireSupabase();
  const sessionToken = getPlayerSessionToken(params.playerId);
  const { data, error } = await client.rpc('submit_challenge_answer', {
    p_match_id: params.matchId,
    p_player_id: params.playerId,
    p_question_id: params.questionId,
    p_selected_index: params.selectedIndex,
    p_item_key: params.itemKey,
    p_challenge_kind: params.challengeKind,
    p_series_correct_count: params.seriesCorrectCount,
    p_series_total: params.seriesTotal,
    p_session_token: sessionToken,
  });

  if (error) {
    throw new Error(error.message || 'Gagal memvalidasi jawaban');
  }

  return data as QuizSubmissionResult;
}
