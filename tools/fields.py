"""出題分野と並び順。order = 分野 × 10000 + 回 × 100 + 問番号"""
FIELDS = ["直流回路", "静電気", "磁気", "交流回路", "三相交流", "過渡現象", "電気計測", "電子理論", "電子回路"]
EXAMS = ["h25", "h26", "h27", "h28", "h29", "h30", "r1", "r2", "r3",
         "r4f", "r4s", "r5f", "r5s", "r6f", "r6s", "r7f", "r7s", "r8f"]


def order_of(field, exam, n):
    return (FIELDS.index(field) + 1) * 10000 + (EXAMS.index(exam) + 1) * 100 + n
