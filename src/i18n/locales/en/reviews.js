// Reviews (!review): the checks of a review, the replies and the post in the channel of new reviews.
// Reference catalog: es and pt-BR must have the same keys and placeholders.
module.exports = {
  'reviews.problem.bot': 'You can not review a bot.',
  'reviews.problem.self': 'You can not review yourself.',
  'reviews.problem.stars': 'The stars are a whole number from 1 to 5.',
  'reviews.problem.comment': 'The comment can have up to {max} characters.',
  'reviews.post.new': '{stars}  {reviewer} reviewed {target}',
  'reviews.post.changed': '{stars}  {reviewer} changed their review of {target}',
  'reviews.give.saved.one': '{emoji}  Review saved. {user} has {stars} {average} from {count} review.',
  'reviews.give.saved.other': '{emoji}  Review saved. {user} has {stars} {average} from {count} reviews.',
  'reviews.give.changed.one': '{emoji}  Your review was changed. {user} has {stars} {average} from {count} review.',
  'reviews.give.changed.other': '{emoji}  Your review was changed. {user} has {stars} {average} from {count} reviews.',
  'reviews.remove.done': '{emoji}  Your review of {user} is removed.',
  'reviews.remove.none': 'You have no review of {user}.',
  'reviews.show.none': '{user} has no reviews yet.',
  'reviews.show.title': '### Reviews of {user}',
  'reviews.show.summary.one': '{stars} **{average}** from {count} review',
  'reviews.show.summary.other': '{stars} **{average}** from {count} reviews',
  'reviews.off': 'Reviews are turned off in this server.',
};
