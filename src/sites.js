/**
 * Site configurations for SeaArt processing.
 *
 * Each entry should include:
 *  - id: short identifier
 *  - name: human-friendly name
 *  - style: prompt style (e.g., 'イラスト', '写実的')
 *  - themeUrl: URL to fetch theme/description and where to post
 *  - imageUrl: URL to use for image generation (may be null/empty to skip)
 *  - promptModel: optional OpenAI model override for prompt generation
 */
module.exports = [
  {
    id: 'daily',
    name: '毎日の挑戦',
    style: 'イラスト',
    themeUrl: 'https://www.seaart.ai/ja/event-center/daily',
    imageUrl: 'https://www.seaart.ai/ja/create/image?id=cuurgide878c73aqlcj0&model_ver_no=c9090ffbe5649de2f34cfe5b865d50fe',
    // promptModel: 'gpt-5-mini'
  },
  {
    id: 'realistic',
    name: '写実チャレンジ',
    style: '写実的',
    themeUrl: 'https://www.seaart.ai/ja/event-center/realistic/',
    imageUrl: 'https://www.seaart.ai/ja/create/image?id=f8172af6747ec762bcf847bd60fdf7cd&model_ver_no=2c39fe1f-f5d6-4b50-a273-499677f2f7a9',
    // promptModel: 'gpt-5-mini'
  }
];
