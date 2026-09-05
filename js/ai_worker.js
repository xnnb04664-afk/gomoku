// 生产构建会把 ai_fast.js 的内容内嵌到 index.html；独立运行时保留该导入作为回退。
importScripts('ai_fast.js');

(function startGomokuAiWorker(scope) {
  'use strict';
  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  scope.onmessage = function handleAiRequest(event) {
    const request = event && event.data ? event.data : {};
    if (request.type !== 'best_move' || !scope.GomokuFastAI) return;
    const startedAt = now();
    try {
      const result = scope.GomokuFastAI.getBestMove(
        request.board,
        Number(request.aiColor) === 1 ? 1 : 2,
        request.difficulty || 'master',
        request.enableFoul === true,
        Array.isArray(request.forbiddenPoints) ? request.forbiddenPoints : [],
        {
          size: Number(request.size) || 15,
          budgetMs: Number(request.budgetMs) || 260,
          maxDepth: Number(request.maxDepth) || 5,
          rootLimit: Number(request.rootLimit) || 14
        }
      );
      scope.postMessage({
        type: 'best_move_result',
        requestId: request.requestId,
        ok: true,
        move: result,
        elapsedMs: Math.round(now() - startedAt),
        nodes: Number(result && result.nodes) || 0,
        depth: Number(result && result.depth) || 0
      });
    } catch (error) {
      scope.postMessage({
        type: 'best_move_result',
        requestId: request.requestId,
        ok: false,
        error: 'AI Worker 计算失败'
      });
    }
  };
})(self);
