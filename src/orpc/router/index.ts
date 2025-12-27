import { addTodo, listTodos } from './todos'
import { getConfigInfo } from './admin'

export default {
  listTodos,
  addTodo,
  admin: {
    getConfigInfo,
  },
}
