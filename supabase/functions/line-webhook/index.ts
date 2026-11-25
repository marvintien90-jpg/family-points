// LINE 群組通知已在 v1.7 移除，這個端點只回 410
Deno.serve(() => new Response("LINE integration removed", { status: 410 }));
