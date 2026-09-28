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
    themeUrl: 'https://www.seaart.ai/ja/community-center',
    imageUrl: 'https://www.seaart.ai/ja/create/image?id=cuurgide878c73aqlcj0&model_ver_no=c9090ffbe5649de2f34cfe5b865d50fe',
    // promptModel: 'gpt-5-mini'
  }
  // ,
  // {
  //   id: 'test',
  //   name: 'テスト用サイト',
  //   style: '写実的',
  //   themeUrl: 'https://www.seaart.ai/ja/event-center/test/',
  //   imageUrl: 'https://www.seaart.ai/ja/create/image?id=d30abh5e878c73flv0gg&model_ver_no=68cc5453f15be7018e34df8f9e99bf08',
  //   promptModel: 'gpt-5-mini'
  // }
];
