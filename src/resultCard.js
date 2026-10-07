function fitText(context, value, width) {
  let text = String(value);
  while (text.length && context.measureText(text).width > width) text = `${text.slice(0, -2)}…`;
  return text;
}

export async function createResultCard(room, ranked) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext('2d');
  const background = context.createLinearGradient(0, 0, 1080, 1350);
  background.addColorStop(0, '#071426');
  background.addColorStop(.6, '#123764');
  background.addColorStop(1, '#0a1b34');
  context.fillStyle = background;
  context.fillRect(0, 0, 1080, 1350);
  const glow = context.createRadialGradient(920, 120, 20, 920, 120, 600);
  glow.addColorStop(0, 'rgba(35, 132, 255, .42)');
  glow.addColorStop(1, 'rgba(35, 132, 255, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 1080, 850);
  context.fillStyle = '#84f347';
  context.fillRect(72, 74, 14, 14);
  context.fillStyle = '#e9f4ff';
  context.font = '700 26px Arial, sans-serif';
  context.fillText('CRICKET DRAFT', 106, 91);
  context.font = '700 76px Arial, sans-serif';
  context.fillText('THE FINAL FIVE', 72, 186);
  context.fillStyle = '#9db6d4';
  context.font = '28px Arial, sans-serif';
  context.fillText(`${room.country}  ·  ${room.format.toUpperCase()}  ·  ${room.size} players`, 74, 234);

  const cardHeight = Math.min(155, Math.floor(934 / ranked.length));
  ranked.forEach((player, index) => {
    const y = 275 + index * cardHeight;
    context.fillStyle = index === 0 ? 'rgba(45, 120, 220, .38)' : 'rgba(196, 216, 245, .12)';
    context.beginPath();
    context.roundRect(70, y, 940, cardHeight - 12, 26);
    context.fill();
    context.fillStyle = index === 0 ? '#a0ff6b' : '#95acc6';
    context.font = '700 40px Arial, sans-serif';
    context.fillText(String(player.rank).padStart(2, '0'), 100, y + 60);
    context.fillStyle = '#f1f7ff';
    context.font = '700 34px Arial, sans-serif';
    context.fillText(fitText(context, player.name, 590), 175, y + 53);
    context.fillStyle = '#9db6d4';
    context.font = '22px Arial, sans-serif';
    const names = player.picks.map((pick) => pick.cricketer?.name || '').join(' · ');
    context.fillText(fitText(context, names, 690), 175, y + 91);
    if (player.balanced) {
      context.fillStyle = '#a0ff6b';
      context.font = '700 19px Arial, sans-serif';
      context.fillText(`PERFECT BALANCE +${player.bonus}`, 175, y + 119);
    }
    context.fillStyle = '#fff';
    context.textAlign = 'right';
    context.font = '700 48px Arial, sans-serif';
    context.fillText(String(player.total), 970, y + 74);
    context.textAlign = 'left';
  });
  context.fillStyle = '#86a3c5';
  context.font = '22px Arial, sans-serif';
  context.fillText('2010+ ERA  ·  FORMAT SCORES  ·  FIVE-PLAYER TEAMS', 72, 1297);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas export failed')), 'image/png'));
}

export async function downloadResultCard(room, ranked) {
  const blob = await createResultCard(room, ranked);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `cricket-draft-${room.code}.png`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
